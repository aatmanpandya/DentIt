"use client";

import { useState } from "react";
import { ProcedureCodePicker, type PinnedPickerRow } from "@/components/chart/procedure-code-picker";
import type { ProcedureCode } from "@/lib/catalog-api";
import type { Surface, Procedure } from "@/lib/chart-api";
import type { NewProcedureItemInput } from "@/lib/treatment-plans-api";

const ALL_SURFACES: Surface[] = ["M", "D", "B", "L", "O", "I"];

/**
 * One picker, one click to open — docs/specs/treatment-planning.md's "Adding a
 * treatment without charting first". Earlier version split this into a "from
 * chart" list and a separate "+ New treatment" mode gated behind its own button
 * (two clicks to reach the catalog at all); this merges them into a single
 * search-and-select list instead: procedures already charted and `planned` for
 * this patient are pinned at the top, tagged "Listed", and select in one click
 * (the original reference-only path); the full catalog follows beneath, and
 * picking any of those starts the scope step (tooth/surfaces/quadrant/arch as the
 * code requires) followed by the one real question — chart it now, or defer.
 */
export function AddItemPicker({
  plannedProcedures,
  codeById,
  pending,
  onSelectExisting,
  onChartNow,
  onDeferred,
  onCancel,
}: {
  plannedProcedures: Procedure[];
  codeById: Map<string, ProcedureCode>;
  pending: boolean;
  onSelectExisting: (chartedProcedureId: string) => void;
  onChartNow: (input: NewProcedureItemInput) => void;
  onDeferred: (input: NewProcedureItemInput) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState<ProcedureCode | null>(null);
  const [tooth, setTooth] = useState("");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [quadrant, setQuadrant] = useState("");
  const [arch, setArch] = useState<"upper" | "lower">("upper");

  function toggleSurface(s: Surface) {
    setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function buildInput(): NewProcedureItemInput | null {
    if (!code) return null;
    switch (code.applies_to) {
      case "tooth":
        return tooth ? { procedure_code_id: code.id, tooth, chart_now: false } : null;
      case "surface":
        return tooth && surfaces.length > 0 ? { procedure_code_id: code.id, tooth, surfaces, chart_now: false } : null;
      case "quadrant":
        return quadrant ? { procedure_code_id: code.id, quadrant, chart_now: false } : null;
      case "arch":
        return { procedure_code_id: code.id, arch, chart_now: false };
      case "mouth":
        return { procedure_code_id: code.id, chart_now: false };
    }
  }

  const ready = buildInput() !== null;

  const pinned: PinnedPickerRow[] = plannedProcedures.flatMap((procedure) => {
    const procedureCode = codeById.get(procedure.procedure_code_id);
    if (!procedureCode) return [];
    return [
      {
        id: procedure.id,
        searchText: `${procedureCode.short_name} ${procedureCode.code}`,
        label: (
          <span className="flex items-center justify-between gap-2">
            <span>
              {procedureCode.short_name}
              {procedure.tooth && <span className="text-ink-soft"> · {procedure.tooth}</span>}
            </span>
            <span className="shrink-0 rounded-[var(--radius)] border border-steel px-1 text-[10px] font-medium uppercase tracking-wide text-steel">
              Listed
            </span>
          </span>
        ),
        onSelect: () => onSelectExisting(procedure.id),
      },
    ];
  });

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-rule bg-paper p-2.5">
      <ProcedureCodePicker scopeFilter={() => true} selectedCodeId={code?.id ?? null} onSelect={setCode} pinned={pinned} />

      {(code?.applies_to === "tooth" || code?.applies_to === "surface") && (
        <input
          value={tooth}
          onChange={(e) => setTooth(e.target.value)}
          placeholder="Tooth (FDI, e.g. 16)"
          className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
        />
      )}
      {code?.applies_to === "surface" && (
        <div className="flex gap-1">
          {ALL_SURFACES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSurface(s)}
              className={`h-7 w-7 rounded-[var(--radius)] border text-[11px] font-medium ${
                surfaces.includes(s) ? "border-steel bg-steel text-white" : "border-rule text-ink hover:bg-steel-lo"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {code?.applies_to === "quadrant" && (
        <select
          value={quadrant}
          onChange={(e) => setQuadrant(e.target.value)}
          className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink"
        >
          <option value="">Select quadrant…</option>
          <option value="UR">Upper right</option>
          <option value="UL">Upper left</option>
          <option value="LL">Lower left</option>
          <option value="LR">Lower right</option>
        </select>
      )}
      {code?.applies_to === "arch" && (
        <select
          value={arch}
          onChange={(e) => setArch(e.target.value as "upper" | "lower")}
          className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink"
        >
          <option value="upper">Upper</option>
          <option value="lower">Lower</option>
        </select>
      )}

      {code && (
        <div className="flex flex-col gap-1.5 border-t border-rule pt-2">
          <p className="text-[11px] text-ink-soft">Add this to the Odontogram now, or just add it to the plan?</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready || pending}
              onClick={() => {
                const input = buildInput();
                if (input) onChartNow({ ...input, chart_now: true });
              }}
              className="h-7 rounded-[var(--radius)] bg-steel px-2.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Chart it now
            </button>
            <button
              type="button"
              disabled={!ready || pending}
              onClick={() => {
                const input = buildInput();
                if (input) onDeferred(input);
              }}
              className="h-7 rounded-[var(--radius)] border border-rule px-2.5 text-[12px] font-medium text-ink hover:bg-steel-lo disabled:opacity-50"
            >
              Just add to plan
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={onCancel} className="self-start text-[11px] text-ink-soft underline">
        Cancel
      </button>
    </div>
  );
}
