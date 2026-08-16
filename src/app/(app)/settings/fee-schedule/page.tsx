"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listProcedureCodes, type ProcedureCode } from "@/lib/catalog-api";
import { listFeeSchedules, createFeeSchedule, listFeeScheduleItems, upsertFeeScheduleItems } from "@/lib/fee-schedule-api";
import { EditableGrid, type GridColumn } from "@/components/catalog/editable-grid";

interface PricedRow {
  procedure: ProcedureCode;
  price: string;
}

// Fee schedule editor — same grid as the catalog, price column, effective dates. See
// docs/specs/ui-design.md's day 6 build-order row.
export default function FeeSchedulePage() {
  const queryClient = useQueryClient();
  const hasTriggeredCreate = useRef(false);

  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: ["fee-schedules"],
    queryFn: listFeeSchedules,
  });
  const schedules = schedulesData?.data ?? [];
  const activeSchedule = schedules.find((s) => s.is_default) ?? schedules[0] ?? null;

  const { data: codesData, isLoading: codesLoading } = useQuery({
    queryKey: ["procedure-codes"],
    queryFn: () => listProcedureCodes({ limit: 200 }),
  });
  const codes = codesData?.data ?? [];

  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ["fee-schedule-items", activeSchedule?.id],
    queryFn: () => listFeeScheduleItems(activeSchedule!.id),
    enabled: Boolean(activeSchedule),
  });
  const items = itemsData?.data ?? [];

  const createDefaultSchedule = useMutation({
    mutationFn: () =>
      createFeeSchedule({ name: "Standard", effective_from: new Date().toISOString().slice(0, 10), is_default: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fee-schedules"] }),
  });

  // No fee schedule yet — create the org's first one automatically rather than
  // blocking the whole screen behind a setup step. Loading state comes from the
  // mutation itself, not a manual setState, to avoid a cascading-render effect.
  useEffect(() => {
    if (!schedulesLoading && schedules.length === 0 && !hasTriggeredCreate.current) {
      hasTriggeredCreate.current = true;
      createDefaultSchedule.mutate();
    }
  }, [schedulesLoading, schedules.length, createDefaultSchedule]);

  const rows: PricedRow[] = codes.map((procedure) => ({
    procedure,
    price: items.find((i) => i.procedure_code_id === procedure.id)?.price ?? "",
  }));

  const columns: GridColumn<PricedRow>[] = [
    { key: "code", header: "Code", data: true, widthClass: "w-40", getValue: (r) => r.procedure.code },
    { key: "name", header: "Procedure", getValue: (r) => r.procedure.short_name },
    { key: "category", header: "Category", widthClass: "w-40", getValue: (r) => r.procedure.category.replace(/_/g, " ") },
    {
      key: "price",
      header: "Price (₹)",
      widthClass: "w-32",
      align: "right",
      data: true,
      editable: { type: "text" },
      getValue: (r) => r.price,
    },
  ];

  async function handleSave(edits: Record<string, Record<string, string>>) {
    if (!activeSchedule) return;
    const toUpsert = Object.entries(edits)
      .map(([procedureCodeId, patch]) => ({ procedure_code_id: procedureCodeId, price: formatPrice(patch.price) }))
      .filter((item): item is { procedure_code_id: string; price: string } => item.price !== null);

    if (toUpsert.length === 0) return;
    await upsertFeeScheduleItems(activeSchedule.id, toUpsert);
    await queryClient.invalidateQueries({ queryKey: ["fee-schedule-items", activeSchedule.id] });
  }

  const isLoading = schedulesLoading || codesLoading || itemsLoading || createDefaultSchedule.isPending;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center justify-between gap-3 border-b border-rule bg-surface px-4 py-3">
        <h1 className="font-condensed text-[13px] font-semibold text-ink">Fee schedule</h1>
        {activeSchedule && (
          <span className="text-[12px] text-ink-soft">
            {activeSchedule.name} · effective {activeSchedule.effective_from}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1" aria-hidden />
      ) : codes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-ink">No procedures to price yet.</p>
          <p className="max-w-xs text-[12px] text-ink-soft">Add procedures to the treatment catalog first.</p>
        </div>
      ) : (
        <EditableGrid rows={rows} getRowId={(r) => r.procedure.id} columns={columns} onSave={handleSave} />
      )}
    </div>
  );
}

// Fee schedule items require a "0.00"-shaped decimal string (src/server/schemas/catalog.ts).
// A blank cell (never priced) or a value that doesn't parse is left out of the save
// entirely rather than sent as a malformed price.
function formatPrice(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}
