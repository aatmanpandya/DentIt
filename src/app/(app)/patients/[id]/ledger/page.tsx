"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Printer, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { createAdjustment, getPatientLedger, listInvoiceable, reversePayment, voidInvoice, type Invoice, type LedgerEntry } from "@/lib/ledger-api";
import { formatRupees, fromPaise, percentOf, toPaise } from "@/lib/format-money";
import { CreateInvoicePanel } from "@/components/ledger/create-invoice-panel";
import { RecordPaymentPanel } from "@/components/ledger/record-payment-panel";

// Duplicated from src/server/lib/permissions.ts's `invoices_payments` row, like the plans
// page does for its own: hiding is not enforcement — the service checks every write.
const LEDGER_WRITE_ROLES = new Set(["owner", "admin", "front_desk", "accountant"]);
const MANAGER_ROLES = new Set(["owner", "admin", "accountant"]);

function dayIn(iso: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Patient Ledger tab — docs/specs/ledger.md. Balance (or credit), invoices with their
 * outstanding, and every invoice, payment, adjustment and void in date order with a
 * running balance. Nothing here edits a ledger row: voids and adjustments are new entries.
 */
export default function PatientLedgerPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { showToast } = useToast();
  const timeZone = user?.organization.timezone ?? "Asia/Kolkata";
  const canWrite = !!user && LEDGER_WRITE_ROLES.has(user.role);

  const { data: ledger, isLoading } = useQuery({ queryKey: ["patient-ledger", params.id], queryFn: () => getPatientLedger(params.id) });
  // ?bill=1 comes from the chart's "Treatment completed — Create invoice" prompt.
  const searchParams = useSearchParams();
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(searchParams.get("bill") === "1");
  // Drop ?bill=1 once used, so a reload doesn't reopen the panel.
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (searchParams.get("bill") === "1") router.replace(pathname);
  }, [searchParams, router, pathname]);
  // Completed treatments not yet on an invoice — surfaced so nothing done goes unbilled.
  const { data: invoiceable } = useQuery({
    queryKey: ["invoiceable", params.id],
    queryFn: () => listInvoiceable(params.id),
    enabled: canWrite,
  });
  const readyToBill = invoiceable?.data ?? [];
  const [paymentPanelOpen, setPaymentPanelOpen] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["patient-ledger", params.id] });
    queryClient.invalidateQueries({ queryKey: ["invoiceable", params.id] });
    queryClient.invalidateQueries({ queryKey: ["patient-summary", params.id] });
    queryClient.invalidateQueries({ queryKey: ["patient-chart", params.id] });
    // Org-wide ledger and any open printable invoice show the same figures.
    queryClient.invalidateQueries({ queryKey: ["organization-ledger"] });
    queryClient.invalidateQueries({ queryKey: ["invoice"] });
  }

  // Same rule as the service: managers any day, front desk only on the day it was recorded.
  function changeBlockedReason(recordedAt: string, earlierDayMessage: string): string | null {
    if (!user || !canWrite) return "You don't have permission to change the ledger.";
    if (MANAGER_ROLES.has(user.role)) return null;
    if (dayIn(recordedAt, timeZone) === dayIn(new Date(), timeZone)) return null;
    return earlierDayMessage;
  }
  function reduceBlockedReason(invoice: Invoice): string | null {
    return changeBlockedReason(invoice.issued_at, "Invoices from earlier days can only be changed by a manager.");
  }

  const balancePaise = ledger ? toPaise(ledger.balance) : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-end justify-between border-b border-rule px-6 py-3">
        <div>
          <span className="text-[12px] text-ink-soft">{balancePaise < 0 ? "Credit" : "Balance due"}</span>
          <div className={clsx("font-data text-[24px]", balancePaise > 0 ? "text-ink" : "text-healthy")}>
            {/* Net figure, same as the patient header: credit = −balance (not gross unapplied credit). */}
            {formatRupees(balancePaise < 0 ? fromPaise(-balancePaise) : (ledger?.balance ?? "0.00"))}
          </div>
          {ledger && balancePaise >= 0 && ledger.credit !== "0.00" && (
            <span className="text-[11px] text-ink-soft">{formatRupees(ledger.credit)} received but not yet applied to an invoice (already counted above)</span>
          )}
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPaymentPanelOpen(true)}
              className="h-8 rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo"
            >
              Record payment
            </button>
            <button
              type="button"
              onClick={() => setInvoicePanelOpen(true)}
              className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
            >
              Create invoice
            </button>
          </div>
        )}
      </div>

      {canWrite && readyToBill.length > 0 && !invoicePanelOpen && (
        <div className="flex flex-none items-center justify-between gap-3 border-b border-caution/30 bg-caution/10 px-6 py-2 text-[12px] text-ink">
          <span>
            <span className="font-medium">
              {readyToBill.length} completed {readyToBill.length === 1 ? "treatment" : "treatments"} not yet invoiced
            </span>
            <span className="text-ink-soft"> — {readyToBill.map((p) => p.short_name + (p.tooth ? ` · ${p.tooth}` : "")).join(", ")}</span>
          </span>
          <button type="button" onClick={() => setInvoicePanelOpen(true)} className="flex-none font-medium text-steel hover:underline">
            Create invoice
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {isLoading ? null : !ledger || (ledger.invoices.length === 0 && ledger.entries.length === 0) ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] border border-rule bg-surface text-ink-soft">
              <Receipt size={22} strokeWidth={1.5} />
            </div>
            <p className="text-[13px] text-ink">No invoices yet.</p>
            <p className="max-w-xs text-[12px] text-ink-soft">Complete a treatment on the chart, then create an invoice for it here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <section>
              <h2 className="mb-2 font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Invoices</h2>
              <ul className="flex flex-col gap-2">
                {ledger.invoices.map((inv) => (
                  <InvoiceRow key={inv.id} patientId={params.id} invoice={inv} blockedReason={reduceBlockedReason(inv)} onChanged={refresh} />
                ))}
              </ul>
            </section>

            <section>
              <h2 className="mb-2 font-condensed text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Activity</h2>
              <table className="w-full border-collapse text-[12px]">
                <thead className="border-b border-rule text-left font-condensed text-[11px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="py-1.5 font-medium">Date</th>
                    <th className="py-1.5 font-medium">Entry</th>
                    <th className="py-1.5 text-right font-medium">Amount</th>
                    <th className="py-1.5 text-right font-medium">Balance</th>
                    <th className="w-20 py-1.5" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {ledger.entries.map((e) => (
                    <ActivityRow
                      key={e.id}
                      entry={e}
                      // Same rule as voids: managers any day, front desk only on the day it was received.
                      reverseBlockedReason={e.kind === "payment" ? changeBlockedReason(e.at, "Payments from earlier days can only be reversed by a manager.") : null}
                      onChanged={refresh}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>

      <CreateInvoicePanel
        patientId={params.id}
        open={invoicePanelOpen}
        onClose={() => setInvoicePanelOpen(false)}
        onCreated={(number) => {
          setInvoicePanelOpen(false);
          showToast({ message: `${number} created.` });
          refresh();
        }}
      />
      <RecordPaymentPanel
        patientId={params.id}
        ledger={ledger}
        open={paymentPanelOpen}
        onClose={() => setPaymentPanelOpen(false)}
        onDone={(message) => {
          setPaymentPanelOpen(false);
          showToast({ message });
          refresh();
        }}
      />
    </div>
  );
}

function InvoiceRow({
  patientId,
  invoice,
  blockedReason,
  onChanged,
}: {
  patientId: string;
  invoice: Invoice & { outstanding: string | null; paid: string };
  blockedReason: string | null;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "void" | "adjust">("idle");
  const [reason, setReason] = useState("");
  const [adjustType, setAdjustType] = useState<"discount" | "writeoff" | "correction">("discount");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustInPercent, setAdjustInPercent] = useState(false);
  const isVoid = invoice.status === "void";
  // What was actually allocated to it — what moves to credit on void. Not total − outstanding,
  // which counts a discount as money paid (docs/bug-log.md entry 14).
  const paid = toPaise(invoice.paid);

  const voidMutation = useMutation({
    mutationFn: () => voidInvoice(invoice.id, reason.trim()),
    onSuccess: () => {
      setMode("idle");
      onChanged();
    },
  });
  // Discounts and write-offs reduce what's owed; a correction may go either way, so it
  // takes the sign the user types.
  // A percentage applies to the invoice total (discounts and write-offs only).
  const usePercent = adjustInPercent && adjustType !== "correction";
  const adjustRupees = usePercent && MONEY.test(adjustAmount) ? percentOf(invoice.total, adjustAmount) : adjustAmount;
  const signedAdjustment = adjustType === "correction" ? adjustAmount : `-${adjustRupees}`;
  const adjustMutation = useMutation({
    mutationFn: () => createAdjustment({ invoice_id: invoice.id, amount: signedAdjustment, adjustment_type: adjustType, reason: reason.trim() }),
    onSuccess: () => {
      setMode("idle");
      setReason("");
      setAdjustAmount("");
      onChanged();
    },
  });

  const field = "h-7 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel";

  return (
    <li className={clsx("rounded-[var(--radius)] border border-rule bg-surface", isVoid && "opacity-60")}>
      <div className="flex items-center gap-4 px-3 py-2 text-[12px]">
        <span className={clsx("font-data font-medium text-ink", isVoid && "line-through")}>{invoice.invoice_number}</span>
        <span className="font-data text-ink-soft">{dateLabel(invoice.issued_at)}</span>
        <span className="font-data text-ink">{formatRupees(invoice.total)}</span>
        <span className="flex-1 text-ink-soft">
          {isVoid ? (
            <>Void — {invoice.void_reason}</>
          ) : invoice.outstanding === "0.00" ? (
            // Nothing due but nothing paid either (e.g. fully discounted) isn't "Paid".
            <span className="text-healthy">{toPaise(invoice.paid) > 0 ? "Paid" : "Settled"}</span>
          ) : (
            <>{formatRupees(invoice.outstanding)} due</>
          )}
        </span>
        <Link
          href={`/patients/${patientId}/invoices/${invoice.id}/print`}
          target="_blank"
          className="flex items-center gap-1 text-steel hover:underline"
        >
          <Printer size={12} /> Print
        </Link>
        {!isVoid && mode === "idle" && (
          <>
            <button type="button" disabled={!!blockedReason} title={blockedReason ?? undefined} onClick={() => setMode("adjust")} className="text-steel hover:underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline">
              Adjust
            </button>
            <button type="button" disabled={!!blockedReason} title={blockedReason ?? undefined} onClick={() => setMode("void")} className="text-bleed hover:underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline">
              Void
            </button>
          </>
        )}
      </div>

      {mode === "void" && (
        <div className="flex flex-col gap-2 border-t border-rule px-3 py-2.5">
          <p className="text-[12px] text-ink">
            Voiding is final. The treatments go back to completed so you can reissue them on a corrected invoice.
            {paid > 0 && (
              <>
                {" "}
                <span className="font-medium">{formatRupees(fromPaise(paid))} already paid will move to patient credit.</span>
              </>
            )}
          </p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required) — e.g. wrong tooth" className={field} autoFocus />
          <div className="flex gap-2">
            <button type="button" disabled={!reason.trim() || voidMutation.isPending} onClick={() => voidMutation.mutate()} className="h-7 rounded-[var(--radius)] bg-bleed px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50">
              Void {invoice.invoice_number}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-7 px-2 text-[12px] text-ink-soft">
              Keep invoice
            </button>
          </div>
          {voidMutation.isError && <p className="text-[12px] text-bleed">{(voidMutation.error as Error).message}</p>}
        </div>
      )}

      {mode === "adjust" && (
        <div className="flex flex-col gap-2 border-t border-rule px-3 py-2.5">
          <div className="flex gap-2">
            <select value={adjustType} onChange={(e) => setAdjustType(e.target.value as typeof adjustType)} className={field} aria-label="Adjustment type">
              <option value="discount">Discount</option>
              <option value="writeoff">Write-off</option>
              <option value="correction">Correction (±)</option>
            </select>
            {adjustType !== "correction" && (
              <div className="flex overflow-hidden rounded-[var(--radius)] border border-rule" role="group" aria-label="Amount in">
                {[false, true].map((pct) => (
                  <button
                    key={String(pct)}
                    type="button"
                    aria-pressed={adjustInPercent === pct}
                    onClick={() => setAdjustInPercent(pct)}
                    className={clsx("h-7 px-2 text-[12px]", adjustInPercent === pct ? "bg-steel text-white" : "bg-surface text-ink-soft hover:bg-steel-lo")}
                  >
                    {pct ? "%" : "₹"}
                  </button>
                ))}
              </div>
            )}
            <input value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value.trim())} placeholder={adjustType === "correction" ? "e.g. -100 or 100" : usePercent ? "% off" : "Amount off"} inputMode="decimal" className={`${field} w-24 text-right font-data`} aria-label="Adjustment amount" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={`${field} flex-1`} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!reason.trim() || !(adjustType === "correction" ? /^-?\d+(\.\d{1,2})?$/.test(adjustAmount) : MONEY.test(adjustAmount)) || adjustMutation.isPending}
              onClick={() => adjustMutation.mutate()}
              className="h-7 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {usePercent && MONEY.test(adjustAmount) ? `Take off ${formatRupees(adjustRupees)}` : "Save adjustment"}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-7 px-2 text-[12px] text-ink-soft">
              Cancel
            </button>
          </div>
          {adjustMutation.isError && <p className="text-[12px] text-bleed">{(adjustMutation.error as Error).message}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * One line of the Activity list. Payments carry a "Reverse" action for money recorded by
 * mistake; reversing is irreversible, so it asks for a reason inline (ui-design.md). A
 * reversed payment stays listed, struck through, next to its "Payment reversed" entry.
 */
function ActivityRow({ entry, reverseBlockedReason, onChanged }: { entry: LedgerEntry; reverseBlockedReason: string | null; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => reversePayment(entry.id, reason.trim()),
    onSuccess: () => {
      setConfirming(false);
      setReason("");
      onChanged();
    },
  });
  const canReverse = entry.kind === "payment" && !entry.reversed;

  return (
    <>
      <tr className="border-b border-rule last:border-b-0">
        <td className="py-1.5 font-data text-ink-soft">{dateLabel(entry.at)}</td>
        <td className={clsx("py-1.5 text-ink", entry.reversed && "text-ink-soft line-through")}>{entry.label}</td>
        <td className={clsx("py-1.5 text-right font-data", entry.amount.startsWith("-") ? "text-healthy" : "text-ink")}>{formatRupees(entry.amount)}</td>
        <td className="py-1.5 text-right font-data text-ink">{formatRupees(entry.balance)}</td>
        <td className="py-1.5 text-right">
          {canReverse && !confirming && (
            <button
              type="button"
              disabled={!!reverseBlockedReason}
              title={reverseBlockedReason ?? undefined}
              onClick={() => setConfirming(true)}
              className="text-[12px] text-bleed hover:underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline"
            >
              Reverse
            </button>
          )}
        </td>
      </tr>
      {confirming && (
        <tr className="border-b border-rule">
          <td colSpan={5} className="py-2">
            <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-rule bg-surface p-2.5">
              <p className="text-[12px] text-ink">
                Reversing takes this {formatRupees(entry.amount.replace("-", ""))} back off the ledger — anything it paid becomes due again.
                The payment stays on record. This can&apos;t be undone.
              </p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (required) — e.g. recorded against the wrong patient"
                className="h-7 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!reason.trim() || mutation.isPending}
                  onClick={() => mutation.mutate()}
                  className="h-7 rounded-[var(--radius)] bg-bleed px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Reverse payment
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="h-7 px-2 text-[12px] text-ink-soft">
                  Keep payment
                </button>
              </div>
              {mutation.isError && <p className="text-[12px] text-bleed">{(mutation.error as Error).message}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
