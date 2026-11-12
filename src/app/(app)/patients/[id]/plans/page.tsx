"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { X, Eye } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/lib/auth-context";
import { getPatientChart } from "@/lib/chart-api";
import { listProcedureCodes } from "@/lib/catalog-api";
import {
  listPatientTreatmentPlans,
  getTreatmentPlan,
  createTreatmentPlan,
  declineTreatmentPlan,
  presentTreatmentPlan,
  acceptTreatmentPlan,
  createPhase,
  reorderPhase,
  addExistingProcedureToPhase,
  addNewProcedureToPhase,
  removeItem,
  reorderItem,
  type TreatmentPlan,
  type TreatmentPlanDetail,
  type TreatmentPlanPhaseDetail,
  type NewProcedureItemInput,
} from "@/lib/treatment-plans-api";
import { SignaturePad } from "@/components/plans/signature-pad";
import { SortablePhase, SortableItemRow } from "@/components/plans/plan-sortable";
import { AddItemPicker } from "@/components/plans/add-item-picker";

// Duplicated from src/server/lib/permissions.ts's `treatment_plans` row, not imported —
// client code never reaches into @/server/lib (same boundary perio/page.tsx keeps).
const PLAN_WRITE_ROLES = new Set(["owner", "admin", "provider", "hygienist"]);

const STATUS_LABEL: Record<TreatmentPlan["status"], string> = {
  draft: "Draft",
  presented: "Presented",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
};

function money(value: string | null): string {
  return value === null ? "—" : `₹${value}`;
}

export default function PatientPlansPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPhaseName, setNewPhaseName] = useState<Record<string, string>>({});
  const [pickerPhaseId, setPickerPhaseId] = useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  const canWrite = !!user?.role && PLAN_WRITE_ROLES.has(user.role);

  const { data: plansData } = useQuery({
    queryKey: ["treatment-plans", params.id],
    queryFn: () => listPatientTreatmentPlans(params.id),
  });
  const plans = useMemo(() => plansData?.data ?? [], [plansData]);
  const activePlanId = selectedPlanId ?? plans[0]?.id ?? null;

  const { data: plan } = useQuery({
    queryKey: ["treatment-plan", activePlanId],
    queryFn: () => getTreatmentPlan(activePlanId as string),
    enabled: !!activePlanId,
  });

  // Item picker's source: this patient's still-`planned` procedures — the plan builder
  // only ever references what's already been charted, per docs/specs/treatment-planning.md.
  const { data: chart } = useQuery({ queryKey: ["patient-chart", params.id], queryFn: () => getPatientChart(params.id) });
  const { data: codesData } = useQuery({ queryKey: ["procedure-codes-all"], queryFn: () => listProcedureCodes({ active: true, limit: 200 }) });
  const codeById = useMemo(() => new Map((codesData?.data ?? []).map((c) => [c.id, c])), [codesData]);
  const onPlanProcedureIds = useMemo(
    () => new Set(plan?.phases.flatMap((p) => p.items.map((i) => i.charted_procedure_id)) ?? []),
    [plan],
  );
  const plannedProcedures = useMemo(
    () => (chart?.procedures ?? []).filter((p) => p.status === "planned" && !onPlanProcedureIds.has(p.id)),
    [chart, onPlanProcedureIds],
  );

  function refetchPlans() {
    queryClient.invalidateQueries({ queryKey: ["treatment-plans", params.id] });
  }
  function refetchDetail() {
    queryClient.invalidateQueries({ queryKey: ["treatment-plan", activePlanId] });
  }

  const createPlanMutation = useMutation({
    mutationFn: () => createTreatmentPlan(params.id, newPlanName),
    onSuccess: (detail) => {
      setNewPlanName("");
      setSelectedPlanId(detail.id);
      refetchPlans();
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => declineTreatmentPlan(activePlanId as string),
    onSuccess: () => {
      setDeclineOpen(false);
      refetchDetail();
      refetchPlans();
    },
  });
  const presentMutation = useMutation({ mutationFn: () => presentTreatmentPlan(activePlanId as string), onSuccess: () => { refetchDetail(); refetchPlans(); } });
  const acceptMutation = useMutation({
    mutationFn: () => acceptTreatmentPlan(activePlanId as string, signature),
    onSuccess: () => {
      setAcceptOpen(false);
      setSignature(null);
      refetchDetail();
      refetchPlans();
      queryClient.invalidateQueries({ queryKey: ["patient-chart", params.id] });
    },
  });

  const createPhaseMutation = useMutation({
    mutationFn: () => createPhase(activePlanId as string, newPhaseName[activePlanId as string] ?? "Untitled phase"),
    onSuccess: () => {
      setNewPhaseName((prev) => ({ ...prev, [activePlanId as string]: "" }));
      refetchDetail();
    },
  });

  function closeItemPicker() {
    setPickerPhaseId(null);
  }

  const addExistingMutation = useMutation({
    mutationFn: (chartedProcedureId: string) => addExistingProcedureToPhase(pickerPhaseId as string, chartedProcedureId),
    onSuccess: () => {
      closeItemPicker();
      refetchDetail();
    },
  });

  const addNewMutation = useMutation({
    mutationFn: (input: NewProcedureItemInput) => addNewProcedureToPhase(pickerPhaseId as string, input),
    onSuccess: () => {
      closeItemPicker();
      refetchDetail();
      // chart_now:true just created a real charted_procedure — the Chart tab (and
      // this page's own "from chart" list) needs to see it too.
      queryClient.invalidateQueries({ queryKey: ["patient-chart", params.id] });
    },
  });

  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => removeItem(itemId), onSuccess: refetchDetail });

  const reorderPhaseMutation = useMutation({
    mutationFn: ({ phaseId, sequence }: { phaseId: string; sequence: number }) => reorderPhase(phaseId, sequence),
    onSuccess: refetchDetail,
  });
  const reorderItemMutation = useMutation({
    mutationFn: ({ itemId, sequence }: { itemId: string; sequence: number }) => reorderItem(itemId, sequence),
    onSuccess: refetchDetail,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Optimistic reorder: dnd-kit already animates the drag via CSS transform, but
  // without writing the new order into the cache immediately, the dropped item
  // snaps back to its old position for a beat until the mutation's invalidate
  // round-trips — the same flash-of-stale-state class of bug perio's save flow hit.
  // The eventual refetch (onSuccess below) reconciles with the server's own order.
  function handlePhaseDragEnd(event: DragEndEvent) {
    if (!plan) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = plan.phases.findIndex((p) => p.id === active.id);
    const newIndex = plan.phases.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    queryClient.setQueryData<TreatmentPlanDetail>(["treatment-plan", activePlanId], {
      ...plan,
      phases: arrayMove(plan.phases, oldIndex, newIndex),
    });
    reorderPhaseMutation.mutate({ phaseId: active.id as string, sequence: newIndex });
  }

  function handleItemDragEnd(phase: TreatmentPlanPhaseDetail, event: DragEndEvent) {
    if (!plan) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = phase.items.findIndex((i) => i.id === active.id);
    const newIndex = phase.items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    queryClient.setQueryData<TreatmentPlanDetail>(["treatment-plan", activePlanId], {
      ...plan,
      phases: plan.phases.map((p) => (p.id === phase.id ? { ...p, items: arrayMove(p.items, oldIndex, newIndex) } : p)),
    });
    reorderItemMutation.mutate({ itemId: active.id as string, sequence: newIndex });
  }

  const editable = plan?.status === "draft" || plan?.status === "presented";

  return (
    <div className="flex gap-4 p-4">
      <aside className="w-48 shrink-0">
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Plans</h2>
        <ul className="flex flex-col gap-1">
          {plans.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  // An open accept/decline confirm belongs to the plan it was opened on —
                  // never let it carry over and act on a different plan.
                  setAcceptOpen(false);
                  setDeclineOpen(false);
                  setSelectedPlanId(p.id);
                }}
                className={clsx(
                  "flex w-full flex-col items-start rounded-[var(--radius)] px-2 py-1.5 text-left text-[12px]",
                  p.id === activePlanId ? "bg-steel-lo font-medium text-ink" : "text-ink-soft hover:bg-steel-lo/50",
                )}
              >
                <span>{p.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-ink-soft">{STATUS_LABEL[p.status]}</span>
              </button>
            </li>
          ))}
        </ul>
        {plans.length === 0 && <p className="text-[12px] text-ink-soft">No treatment plans yet.</p>}
        {canWrite && (
          <div className="mt-3 flex flex-col gap-1">
            <input
              value={newPlanName}
              onChange={(e) => setNewPlanName(e.target.value)}
              placeholder="Plan name"
              className="h-7 w-full rounded-[var(--radius)] border border-rule bg-surface px-1.5 text-[12px] text-ink outline-none focus-visible:border-steel"
            />
            <button
              type="button"
              disabled={!newPlanName.trim() || createPlanMutation.isPending}
              onClick={() => createPlanMutation.mutate()}
              className="h-7 w-full rounded-[var(--radius)] bg-steel px-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              New plan
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {!activePlanId && <p className="text-ink-soft">No treatment plans yet. Start one.</p>}

        {activePlanId && plan && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-condensed text-lg font-medium text-ink">{plan.name}</h1>
                <p className="text-[12px] text-ink-soft">{STATUS_LABEL[plan.status]}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/patients/${params.id}/plans/${plan.id}/present`}
                  target="_blank"
                  className="flex h-7 items-center gap-1 rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo"
                >
                  <Eye size={13} /> View presentation
                </Link>
                {canWrite && plan.status === "draft" && (
                  <button
                    type="button"
                    disabled={presentMutation.isPending}
                    onClick={() => presentMutation.mutate()}
                    className="h-7 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    Present to patient
                  </button>
                )}
                {canWrite && plan.status === "presented" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeclineOpen(false);
                      setAcceptOpen(true);
                    }}
                    className="h-7 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    Accept
                  </button>
                )}
                {canWrite && (plan.status === "draft" || plan.status === "presented") && (
                  <button
                    type="button"
                    onClick={() => {
                      setAcceptOpen(false);
                      setDeclineOpen(true);
                    }}
                    className="h-7 rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo"
                  >
                    Decline
                  </button>
                )}
              </div>
            </div>

            {/* Declining is irreversible (no transition out of `declined`), so it confirms —
                ui-design.md: "Confirm only for irreversible things". Inline, not a modal. */}
            {declineOpen && (
              <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-rule bg-surface p-3">
                <p className="text-[12px] text-ink">
                  Declining is final — this plan can&apos;t be reopened or accepted later. Its charted procedures stay on the
                  chart as planned.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={declineMutation.isPending}
                    onClick={() => declineMutation.mutate()}
                    className="h-7 rounded-[var(--radius)] bg-bleed px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Decline plan
                  </button>
                  <button type="button" onClick={() => setDeclineOpen(false)} className="h-7 px-2 text-[12px] text-ink-soft">
                    Keep plan
                  </button>
                </div>
                {declineMutation.isError && (
                  <p className="text-[12px] text-bleed">{(declineMutation.error as Error).message}</p>
                )}
              </div>
            )}

            {acceptOpen && (
              <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-rule bg-surface p-3">
                <p className="text-[12px] text-ink">
                  Accepting locks this plan and snapshots today&apos;s prices onto each item — see{" "}
                  <span className="font-medium">Total {money(plan.total)}</span> below.
                </p>
                <SignaturePad onChange={setSignature} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={acceptMutation.isPending}
                    onClick={() => acceptMutation.mutate()}
                    className="h-7 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Confirm acceptance
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAcceptOpen(false);
                      setSignature(null);
                    }}
                    className="h-7 px-2 text-[12px] text-ink-soft"
                  >
                    Cancel
                  </button>
                </div>
                {acceptMutation.isError && (
                  <p className="text-[12px] text-bleed">{(acceptMutation.error as Error).message}</p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePhaseDragEnd}>
                <SortableContext items={plan.phases.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  {plan.phases.map((phase) => (
                    <SortablePhase
                      key={phase.id}
                      id={phase.id}
                      disabled={!(canWrite && editable)}
                      className="rounded-[var(--radius)] border border-rule bg-surface"
                    >
                      {(dragHandle) => (
                        <>
                          <div className="flex items-center justify-between border-b border-rule px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              {dragHandle}
                              <span className="text-[13px] font-medium text-ink">{phase.name}</span>
                            </div>
                            <span className="font-data text-[12px] text-ink-soft">Subtotal {money(phase.subtotal)}</span>
                          </div>

                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => handleItemDragEnd(phase, event)}
                          >
                            <SortableContext items={phase.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                              <ul>
                                {phase.items.map((item) => (
                                  <SortableItemRow
                                    key={item.id}
                                    id={item.id}
                                    disabled={!(canWrite && editable)}
                                    className="flex items-center justify-between border-b border-rule px-3 py-1.5 last:border-b-0"
                                  >
                                    {(itemHandle) => (
                                      <>
                                        <div className="flex items-center gap-2">
                                          {itemHandle}
                                          <span className="text-[12px] text-ink">
                                            {item.procedure_short_name}
                                            {item.tooth && <span className="text-ink-soft"> · {item.tooth}</span>}
                                          </span>
                                          {item.procedure_status === null && (
                                            <span
                                              className="rounded-[var(--radius)] border border-caution px-1 text-[10px] font-medium uppercase tracking-wide text-caution"
                                              title="Not on the Odontogram yet — charted automatically when this plan is accepted"
                                            >
                                              Not charted
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="font-data text-[12px] text-ink-soft">{money(item.price)}</span>
                                          {canWrite && editable && (
                                            <button
                                              type="button"
                                              onClick={() => removeItemMutation.mutate(item.id)}
                                              className="text-ink-soft hover:text-bleed"
                                              aria-label="Remove item"
                                            >
                                              <X size={13} />
                                            </button>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </SortableItemRow>
                                ))}
                                {phase.items.length === 0 && (
                                  <li className="px-3 py-2 text-[12px] text-ink-soft">No items yet.</li>
                                )}
                              </ul>
                            </SortableContext>
                          </DndContext>

                          {canWrite && editable && (
                            <div className="border-t border-rule px-3 py-1.5">
                              {pickerPhaseId === phase.id ? (
                                <AddItemPicker
                                  plannedProcedures={plannedProcedures}
                                  codeById={codeById}
                                  pending={addExistingMutation.isPending || addNewMutation.isPending}
                                  onSelectExisting={(chartedProcedureId) => addExistingMutation.mutate(chartedProcedureId)}
                                  onChartNow={(input) => addNewMutation.mutate(input)}
                                  onDeferred={(input) => addNewMutation.mutate(input)}
                                  onCancel={closeItemPicker}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPickerPhaseId(phase.id)}
                                  className="text-[12px] font-medium text-steel hover:opacity-80"
                                >
                                  + Add item
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </SortablePhase>
                  ))}
                </SortableContext>
              </DndContext>

              {canWrite && editable && (
                <div className="flex items-center gap-1.5">
                  <input
                    value={newPhaseName[activePlanId] ?? ""}
                    onChange={(e) => setNewPhaseName((prev) => ({ ...prev, [activePlanId]: e.target.value }))}
                    placeholder="New phase name"
                    className="h-7 w-48 rounded-[var(--radius)] border border-rule bg-surface px-1.5 text-[12px] text-ink outline-none focus-visible:border-steel"
                  />
                  <button
                    type="button"
                    disabled={createPhaseMutation.isPending}
                    onClick={() => createPhaseMutation.mutate()}
                    className="h-7 rounded-[var(--radius)] border border-rule px-2 text-[12px] font-medium text-ink hover:bg-steel-lo"
                  >
                    + Add phase
                  </button>
                </div>
              )}

              <div className="flex justify-end border-t border-rule pt-2">
                <span className="text-[13px] font-medium text-ink">Total {money(plan.total)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
