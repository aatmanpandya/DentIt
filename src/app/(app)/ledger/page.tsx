"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Receipt } from "lucide-react";
import { getOrganizationLedger } from "@/lib/ledger-api";
import { formatRupees, fromPaise, toPaise } from "@/lib/format-money";

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Organisation-wide ledger — the side rail's "Ledger" entry (docs/specs/ledger.md):
 * who owes money, and the most recent invoices. Each row links to that patient's
 * Ledger tab; balances use the same calculation as the tab.
 */
export default function LedgerPage() {
  const { data, isLoading } = useQuery({ queryKey: ["organization-ledger"], queryFn: getOrganizationLedger });

  const owing = (data?.balances ?? []).filter((b) => toPaise(b.balance) > 0);
  const inCredit = (data?.balances ?? []).filter((b) => toPaise(b.balance) < 0);
  const totalOutstanding = owing.reduce((sum, b) => sum + toPaise(b.balance), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-end justify-between border-b border-rule bg-surface px-4 py-3">
        <h1 className="font-condensed text-[15px] font-medium text-ink">Ledger</h1>
        {data && (
          <span className="text-[12px] text-ink-soft">
            Outstanding <span className="font-data text-[15px] text-ink">{formatRupees(fromPaise(totalOutstanding))}</span> across {owing.length}{" "}
            {owing.length === 1 ? "patient" : "patients"}
          </span>
        )}
      </div>

      {isLoading ? null : !data || (data.recent_invoices.length === 0 && data.balances.length === 0) ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] border border-rule bg-surface text-ink-soft">
            <Receipt size={22} strokeWidth={1.5} />
          </div>
          <p className="text-[13px] text-ink">No invoices yet.</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto px-4 py-4 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Balances</h2>
            {data.balances.length === 0 ? (
              <p className="text-[12px] text-ink-soft">Every patient is settled up.</p>
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {[...owing, ...inCredit].map((b) => (
                    <tr key={b.patient?.id} className="border-b border-rule hover:bg-steel-lo">
                      <td className="py-0">
                        <Link href={`/patients/${b.patient?.id}/ledger`} className="flex h-[28px] items-center text-ink">
                          {b.patient?.first_name} {b.patient?.last_name}
                          <span className="ml-2 font-data text-ink-soft">{b.patient?.patient_number}</span>
                        </Link>
                      </td>
                      <td className={clsx("text-right font-data", toPaise(b.balance) < 0 ? "text-healthy" : "text-ink")}>
                        {toPaise(b.balance) < 0 ? `${formatRupees(fromPaise(-toPaise(b.balance)))} credit` : `${formatRupees(b.balance)} due`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Recent invoices</h2>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {data.recent_invoices.map((inv) => (
                  <tr key={inv.id} className={clsx("border-b border-rule hover:bg-steel-lo", inv.status === "void" && "opacity-60")}>
                    <td className="py-0">
                      <Link href={`/patients/${inv.patient?.id}/ledger`} className="flex h-[28px] items-center gap-2 text-ink">
                        <span className={clsx("font-data", inv.status === "void" && "line-through")}>{inv.invoice_number}</span>
                        <span className="text-ink-soft">
                          {inv.patient?.first_name} {inv.patient?.last_name}
                        </span>
                      </Link>
                    </td>
                    <td className="font-data text-ink-soft">{dateLabel(inv.issued_at)}</td>
                    <td className="text-right font-data text-ink">{inv.status === "void" ? "Void" : formatRupees(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
