"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ClipboardList } from "lucide-react";
import { listTreatmentPlans, type OrganizationTreatmentPlanRow, type TreatmentPlanStatus } from "@/lib/treatment-plans-api";

const FILTERS: { value: TreatmentPlanStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "draft", label: "Draft" },
  { value: "presented", label: "Presented" },
  { value: "accepted", label: "Accepted" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
];

const STATUS_LABEL: Record<TreatmentPlanStatus, string> = {
  draft: "Draft",
  presented: "Presented",
  accepted: "Accepted",
  completed: "Completed",
  declined: "Declined",
};

function totalLabel(row: OrganizationTreatmentPlanRow): string {
  if (row.total !== null) return `₹${row.total}`;
  return `${row.unpriced_count} unpriced`;
}

function updatedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Organisation-wide treatment plans — the side rail's "Treatment plans" entry. Every row
 * links through to that patient's Plans tab with the plan selected. Same dense table
 * pattern as the patient list (ui-design.md).
 */
export default function TreatmentPlansPage() {
  const [status, setStatus] = useState<TreatmentPlanStatus | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["treatment-plans-org", status],
    queryFn: () => listTreatmentPlans(status ?? undefined),
  });
  const rows = data?.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <h1 className="font-condensed text-[15px] font-medium text-ink">Treatment plans</h1>
        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={clsx(
                "h-7 rounded-[var(--radius)] px-2.5 text-[12px] font-medium",
                status === f.value ? "bg-steel text-white" : "text-ink-soft hover:bg-steel-lo",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1" aria-hidden />
      ) : rows.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] border border-rule bg-surface text-ink-soft">
            <ClipboardList size={22} strokeWidth={1.5} />
          </div>
          <p className="text-[13px] text-ink">
            {status ? `No ${STATUS_LABEL[status].toLowerCase()} plans.` : "No treatment plans yet."}
          </p>
          {!status && <p className="max-w-xs text-[12px] text-ink-soft">Plans are built from a patient&apos;s Plans tab.</p>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 border-b border-rule bg-paper text-left font-condensed text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2 font-medium">Patient</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-rule last:border-b-0 hover:bg-steel-lo">
                  <td className="h-[28px] px-0 py-0">
                    <Link
                      href={`/patients/${row.patient.id}/plans?plan=${row.id}`}
                      className="flex h-[28px] items-center px-4 text-ink outline-none focus-visible:bg-steel-lo"
                    >
                      {row.patient.first_name} {row.patient.last_name}
                    </Link>
                  </td>
                  <td className="px-4 text-ink">{row.name}</td>
                  <td className="px-4 text-ink-soft">{STATUS_LABEL[row.status]}</td>
                  <td className={clsx("px-4 text-right font-data", row.total === null ? "text-caution" : "text-ink")}>
                    {totalLabel(row)}
                  </td>
                  <td className="px-4 font-data text-ink-soft">{updatedLabel(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
