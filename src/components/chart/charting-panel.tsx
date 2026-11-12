"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import clsx from "clsx";
import type { Condition, Procedure, Surface } from "@/lib/chart-api";
import {
  createCondition,
  createProcedure,
  updateCondition,
  updateProcedureStatus,
  completeProcedure,
  deleteProcedure,
} from "@/lib/chart-api";
import { validSurfacesForFdi } from "./tooth-shapes";
import { ProcedureCodePicker } from "./procedure-code-picker";
import { useToast } from "@/components/ui/toast";
import { listProcedureCodes, type ProcedureCode } from "@/lib/catalog-api";

const COMMON_CONDITION_TYPES = [
  "caries",
  "fracture",
  "impacted",
  "furcation_involvement",
  "missing",
  "existing_crown",
  "existing_rct",
  "existing_restoration",
];

const STATUS_LABEL: Record<Procedure["status"], string> = {
  planned: "Planned",
  accepted: "Accepted",
  scheduled: "Scheduled",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export interface ChartingPanelProps {
  patientId: string;
  selectedFdi: string | null;
  initialSurface?: Surface | null;
  conditions: Condition[];
  procedures: Procedure[];
  onChanged: () => void;
}

export function ChartingPanel({ patientId, selectedFdi, initialSurface, conditions, procedures, onChanged }: ChartingPanelProps) {
  return (
    <div className="flex h-full flex-col border-l border-rule bg-surface">
      <div className="flex-none border-b border-rule px-3 py-2.5">
        <h2 className="font-condensed text-[13px] font-semibold text-ink">Chart</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selectedFdi ? (
          <ToothPanelContent
            key={selectedFdi}
            patientId={patientId}
            fdi={selectedFdi}
            initialSurface={initialSurface ?? null}
            conditions={conditions.filter((c) => c.tooth === selectedFdi)}
            procedures={procedures.filter((p) => p.tooth === selectedFdi)}
            onChanged={onChanged}
          />
        ) : (
          <p className="text-[12px] text-ink-soft">Select a tooth to chart.</p>
        )}
      </div>
    </div>
  );
}

function ToothPanelContent({
  patientId,
  fdi,
  initialSurface,
  conditions,
  procedures,
  onChanged,
}: {
  patientId: string;
  fdi: string;
  initialSurface: Surface | null;
  conditions: Condition[];
  procedures: Procedure[];
  onChanged: () => void;
}) {
  const validSurfaces = validSurfacesForFdi(fdi);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="font-data text-[15px] font-medium text-ink">Tooth {fdi}</span>
        {initialSurface && <span className="ml-2 rounded-[var(--radius)] bg-steel-lo px-1.5 py-0.5 text-[11px] text-steel">{initialSurface}</span>}
      </div>

      <ConditionForm patientId={patientId} fdi={fdi} initialSurface={initialSurface} validSurfaces={validSurfaces} onChanged={onChanged} />
      <ProcedureForm patientId={patientId} fdi={fdi} initialSurface={initialSurface} validSurfaces={validSurfaces} onChanged={onChanged} />

      <HistorySection patientId={patientId} conditions={conditions} procedures={procedures} onChanged={onChanged} />
    </div>
  );
}

function SurfaceToggles({ valid, selected, onToggle }: { valid: Surface[]; selected: Surface[]; onToggle: (s: Surface) => void }) {
  return (
    <div className="flex gap-1">
      {valid.map((surface) => (
        <button
          key={surface}
          type="button"
          onClick={() => onToggle(surface)}
          className={clsx(
            "h-7 w-7 rounded-[var(--radius)] border text-[11px] font-medium",
            selected.includes(surface) ? "border-steel bg-steel text-white" : "border-rule text-ink-soft hover:bg-steel-lo",
          )}
        >
          {surface}
        </button>
      ))}
    </div>
  );
}

function ConditionForm({
  patientId,
  fdi,
  initialSurface,
  validSurfaces,
  onChanged,
}: {
  patientId: string;
  fdi: string;
  initialSurface: Surface | null;
  validSurfaces: Surface[];
  onChanged: () => void;
}) {
  const [conditionType, setConditionType] = useState(COMMON_CONDITION_TYPES[0]);
  const [surfaces, setSurfaces] = useState<Surface[]>(initialSurface ? [initialSurface] : []);
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => createCondition(patientId, { tooth: fdi, surfaces: surfaces.length ? surfaces : null, condition_type: conditionType, note: note || null }),
    onSuccess: () => {
      setSurfaces([]);
      setNote("");
      onChanged();
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-rule p-2.5">
      <h3 className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Condition</h3>
      <select
        value={conditionType}
        onChange={(e) => setConditionType(e.target.value)}
        className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
      >
        {COMMON_CONDITION_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <SurfaceToggles valid={validSurfaces} selected={surfaces} onToggle={(s) => setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))} />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
      />
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-8 rounded-[var(--radius)] bg-steel text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Chart condition"}
      </button>
    </div>
  );
}

function ProcedureForm({
  patientId,
  fdi,
  initialSurface,
  validSurfaces,
  onChanged,
}: {
  patientId: string;
  fdi: string;
  initialSurface: Surface | null;
  validSurfaces: Surface[];
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [code, setCode] = useState<ProcedureCode | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>(initialSurface ? [initialSurface] : []);
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      if (!code) throw new Error("Pick a treatment first.");
      return createProcedure(patientId, {
        procedure_code_id: code.id,
        tooth: fdi,
        surfaces: code.applies_to === "surface" ? surfaces : null,
        note: note || null,
      });
    },
    onSuccess: (created) => {
      setCode(null);
      setSurfaces([]);
      setNote("");
      onChanged();
      showToast({
        message: `${created.status === "planned" ? "Planned" : "Charted"} on tooth ${fdi}.`,
        onUndo: () => deleteProcedure(created.id).then(onChanged),
      });
    },
  });

  const needsSurfaces = code?.applies_to === "surface";

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-rule p-2.5">
      <h3 className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Treatment</h3>
      <ProcedureCodePicker
        scopeFilter={(c) => c.applies_to === "tooth" || c.applies_to === "surface"}
        selectedCodeId={code?.id ?? null}
        onSelect={setCode}
      />
      {needsSurfaces && (
        <SurfaceToggles valid={validSurfaces} selected={surfaces} onToggle={(s) => setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))} />
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
      />
      <button
        type="button"
        disabled={mutation.isPending || !code || (needsSurfaces && surfaces.length === 0)}
        onClick={() => mutation.mutate()}
        className="h-8 rounded-[var(--radius)] bg-steel text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Chart treatment"}
      </button>
    </div>
  );
}

// Duplicated from server/lib/permissions.ts's invoices_payments write row (client code never
// imports server modules) — only these roles get the "Create invoice" shortcut.
const INVOICE_WRITE_ROLES = new Set(["owner", "admin", "front_desk", "accountant"]);

function HistorySection({
  patientId,
  conditions,
  procedures,
  onChanged,
}: {
  patientId: string;
  conditions: Condition[];
  procedures: Procedure[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  // Cancelling is final (a cancelled procedure has no way back), so it confirms inline —
  // ui-design.md: "Confirm only for irreversible things".
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const resolveCondition = useMutation({
    mutationFn: (id: string) => updateCondition(id, { resolve: true }),
    onSuccess: onChanged,
  });
  const cancelProcedure = useMutation({
    mutationFn: (id: string) => updateProcedureStatus(id, "cancelled"),
    onSuccess: () => {
      setConfirmCancelId(null);
      onChanged();
    },
  });
  const completeProcedureMutation = useMutation({
    mutationFn: (id: string) => completeProcedure(id),
    onSuccess: () => {
      onChanged();
      // Completing is usually followed by billing — offer it right here instead of making
      // staff go and find the Ledger tab.
      if (user && INVOICE_WRITE_ROLES.has(user.role)) {
        showToast({
          message: "Treatment completed.",
          action: { label: "Create invoice", onClick: () => router.push(`/patients/${patientId}/ledger?bill=1`) },
        });
      }
    },
  });
  const removeProcedure = useMutation({
    mutationFn: (id: string) => deleteProcedure(id),
    onSuccess: onChanged,
  });

  const pending = resolveCondition.isPending || cancelProcedure.isPending || completeProcedureMutation.isPending || removeProcedure.isPending;

  // Name each procedure — a bare status ("Accepted") doesn't say what was done. All codes,
  // not just active ones: a procedure can outlive its code being retired from the catalogue.
  const { data: codes } = useQuery({ queryKey: ["procedure-codes", "all"], queryFn: () => listProcedureCodes({ limit: 200 }) });
  const codeName = (id: string) => codes?.data.find((c) => c.id === id)?.short_name ?? "Procedure";

  if (conditions.length === 0 && procedures.length === 0) {
    return <p className="text-[12px] text-ink-soft">No history for this tooth yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">History</h3>
      <ul className="flex flex-col gap-1.5">
        {conditions.map((c) => (
          <li key={c.id} className={clsx("flex items-center justify-between rounded-[var(--radius)] border border-rule px-2 py-1.5 text-[12px]", c.resolved_at && "opacity-50")}>
            <span>
              {c.condition_type.replace(/_/g, " ")}
              {c.surfaces?.length ? ` (${c.surfaces.join("")})` : ""}
            </span>
            {!c.resolved_at && (
              <button disabled={pending} onClick={() => resolveCondition.mutate(c.id)} className="text-[11px] text-steel hover:underline">
                Resolve
              </button>
            )}
          </li>
        ))}
        {procedures.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-[var(--radius)] border border-rule px-2 py-1.5 text-[12px]">
            <span>
              {codeName(p.procedure_code_id)}
              {p.surfaces?.length ? ` (${p.surfaces.join("")})` : ""}
              <span className="ml-1.5 text-ink-soft">· {STATUS_LABEL[p.status]}</span>
            </span>
            <span className="flex gap-2">
              {/* `scheduled` is optional — work done chairside completes straight from here. */}
              {(p.status === "planned" || p.status === "accepted" || p.status === "scheduled") && (
                <button disabled={pending} onClick={() => completeProcedureMutation.mutate(p.id)} className="text-[11px] text-steel hover:underline">
                  Complete
                </button>
              )}
              {(p.status === "planned" || p.status === "accepted" || p.status === "scheduled") && (
                confirmCancelId === p.id ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink">Cancel for good?</span>
                    <button disabled={pending} onClick={() => cancelProcedure.mutate(p.id)} className="text-[11px] font-medium text-bleed hover:underline">
                      Yes, cancel
                    </button>
                    <button onClick={() => setConfirmCancelId(null)} className="text-[11px] text-ink-soft hover:text-ink">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button disabled={pending} onClick={() => setConfirmCancelId(p.id)} className="text-[11px] text-ink-soft hover:text-ink">
                    Cancel
                  </button>
                )
              )}
              {p.status === "planned" && (
                <button disabled={pending} onClick={() => removeProcedure.mutate(p.id)} className="text-[11px] text-bleed hover:underline">
                  Delete
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {/* A refused change (e.g. the treatment is on a plan not yet accepted) must say why,
          not fail silently. */}
      {[cancelProcedure, completeProcedureMutation, removeProcedure, resolveCondition].map((m, i) =>
        m.isError ? (
          <p key={i} className="text-[12px] text-bleed">
            {(m.error as Error).message}
          </p>
        ) : null,
      )}
    </div>
  );
}
