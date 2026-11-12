"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProcedureCodes, type ProcedureCode } from "@/lib/catalog-api";

export interface PinnedPickerRow {
  id: string;
  // What the search box matches against — not necessarily what's rendered.
  searchText: string;
  label: ReactNode;
  onSelect: () => void;
}

/**
 * Shared between the charting panel (tooth/surface-scoped codes), the
 * mouth/arch/quadrant-scoped procedures list, and the treatment-plan item picker —
 * docs/specs/odontogram.md keeps the odontogram itself purely tooth/surface-scoped,
 * so the scope filter is the only thing that differs between call sites.
 *
 * `pinned` rows (docs/specs/treatment-planning.md's "Adding a treatment without
 * charting first" — the already-charted-and-planned procedures the plan builder
 * surfaces first) render above the catalog list, filtered by the same search box,
 * with their own `onSelect` rather than going through the catalog's `onSelect` —
 * picking one is a different action (link an existing procedure) than picking a
 * catalog code (start the new-procedure scope step).
 */
export function ProcedureCodePicker({
  scopeFilter,
  selectedCodeId,
  onSelect,
  pinned = [],
}: {
  scopeFilter: (code: ProcedureCode) => boolean;
  selectedCodeId: string | null;
  onSelect: (code: ProcedureCode) => void;
  pinned?: PinnedPickerRow[];
}) {
  const [query, setQuery] = useState("");
  const { data } = useQuery({ queryKey: ["procedure-codes", "active"], queryFn: () => listProcedureCodes({ active: true, limit: 200 }) });

  const matches = (text: string) => query === "" || text.toLowerCase().includes(query.toLowerCase());

  const matchingPinned = pinned.filter((row) => matches(row.searchText));
  const codes = (data?.data ?? []).filter((code) => scopeFilter(code) && (matches(code.short_name) || matches(code.code)));

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search treatments…"
        className="h-8 w-full rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-auto">
        {matchingPinned.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={row.onSelect}
            className="rounded-[var(--radius)] px-2 py-1.5 text-left text-[12px] text-ink hover:bg-steel-lo"
          >
            {row.label}
          </button>
        ))}
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
        {matchingPinned.length === 0 && codes.length === 0 && <p className="px-2 py-1.5 text-[12px] text-ink-soft">No matching treatments.</p>}
      </div>
    </div>
  );
}
