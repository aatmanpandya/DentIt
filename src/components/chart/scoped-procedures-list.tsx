"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Procedure } from "@/lib/chart-api";
import { createProcedure } from "@/lib/chart-api";
import { ProcedureCodePicker } from "./procedure-code-picker";
import type { ProcedureCode } from "@/lib/catalog-api";

const STATUS_LABEL: Record<Procedure["status"], string> = {
  planned: "Planned",
  accepted: "Accepted",
  scheduled: "Scheduled",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

/**
 * The odontogram SVG is purely for tooth/surface-scoped codes — docs/specs/
 * odontogram.md. Whole-mouth, arch, and quadrant-scoped procedures (a cleaning, an
 * exam, deep scaling per quadrant) have no single tooth to click, so they're
 * charted from this plain list instead, reusing ProcedureCodePicker minus the
 * tooth/surface step. The full-mouth option stays visibly listed, not buried.
 */
export function ScopedProceduresList({
  patientId,
  procedures,
  onChanged,
}: {
  patientId: string;
  procedures: Procedure[];
  onChanged: () => void;
}) {
  const [code, setCode] = useState<ProcedureCode | null>(null);
  const [quadrant, setQuadrant] = useState("");
  const [arch, setArch] = useState<"upper" | "lower">("upper");

  const mutation = useMutation({
    mutationFn: () => {
      if (!code) throw new Error("Pick a treatment first.");
      return createProcedure(patientId, {
        procedure_code_id: code.id,
        quadrant: code.applies_to === "quadrant" ? quadrant : null,
        arch: code.applies_to === "arch" ? arch : null,
      });
    },
    onSuccess: () => {
      setCode(null);
      onChanged();
    },
  });

  const scoped = procedures.filter((p) => !p.tooth);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-condensed text-[13px] font-semibold text-ink">Whole-mouth, arch &amp; quadrant treatments</h2>

      <ProcedureCodePicker
        scopeFilter={(c) => c.applies_to === "mouth" || c.applies_to === "arch" || c.applies_to === "quadrant"}
        selectedCodeId={code?.id ?? null}
        onSelect={setCode}
      />

      {code?.applies_to === "quadrant" && (
        <select value={quadrant} onChange={(e) => setQuadrant(e.target.value)} className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px]">
          <option value="">Select quadrant…</option>
          <option value="UR">Upper right</option>
          <option value="UL">Upper left</option>
          <option value="LL">Lower left</option>
          <option value="LR">Lower right</option>
        </select>
      )}
      {code?.applies_to === "arch" && (
        <select value={arch} onChange={(e) => setArch(e.target.value as "upper" | "lower")} className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px]">
          <option value="upper">Upper</option>
          <option value="lower">Lower</option>
        </select>
      )}

      <button
        type="button"
        disabled={mutation.isPending || !code || (code.applies_to === "quadrant" && !quadrant)}
        onClick={() => mutation.mutate()}
        className="h-8 rounded-[var(--radius)] bg-steel text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Chart treatment"}
      </button>

      <ul className="flex flex-col gap-1.5">
        {scoped.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-[var(--radius)] border border-rule px-2 py-1.5 text-[12px]">
            <span>
              {p.arch ? `${p.arch} arch` : p.quadrant ? `Quadrant ${p.quadrant}` : "Whole mouth"}
            </span>
            <span className="text-ink-soft">{STATUS_LABEL[p.status]}</span>
          </li>
        ))}
        {scoped.length === 0 && <p className="text-[12px] text-ink-soft">Nothing charted at this scope yet.</p>}
      </ul>
    </div>
  );
}
