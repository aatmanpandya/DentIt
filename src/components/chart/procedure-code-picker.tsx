"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProcedureCodes, type ProcedureCode } from "@/lib/catalog-api";

/**
 * Shared between the charting panel (tooth/surface-scoped codes) and the
 * mouth/arch/quadrant-scoped procedures list — docs/specs/odontogram.md keeps the
 * odontogram itself purely tooth/surface-scoped, so the scope filter is the only
 * thing that differs between the two call sites.
 */
export function ProcedureCodePicker({
  scopeFilter,
  selectedCodeId,
  onSelect,
}: {
  scopeFilter: (code: ProcedureCode) => boolean;
  selectedCodeId: string | null;
  onSelect: (code: ProcedureCode) => void;
}) {
  const [query, setQuery] = useState("");
  const { data } = useQuery({ queryKey: ["procedure-codes", "active"], queryFn: () => listProcedureCodes({ active: true, limit: 200 }) });

  const codes = (data?.data ?? []).filter(
    (code) => scopeFilter(code) && (query === "" || code.short_name.toLowerCase().includes(query.toLowerCase()) || code.code.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search treatments…"
        className="h-8 w-full rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-auto">
        {codes.map((code) => (
          <button
            key={code.id}
            type="button"
            onClick={() => onSelect(code)}
            className={`flex items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-[12px] ${
              selectedCodeId === code.id ? "bg-steel text-white" : "text-ink hover:bg-steel-lo"
            }`}
          >
            <span>{code.short_name}</span>
            <span className="font-data text-[11px] opacity-70">{code.code}</span>
          </button>
        ))}
        {codes.length === 0 && <p className="px-2 py-1.5 text-[12px] text-ink-soft">No matching treatments.</p>}
      </div>
    </div>
  );
}
