"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SidePanel } from "@/components/ui/side-panel";
import { listLocations } from "@/lib/schedule-api";
import { applyCredit, recordPayment, suggestLocation, type PatientLedger, type PaymentMethod } from "@/lib/ledger-api";
import { addMoney, formatRupees, fromPaise, toPaise } from "@/lib/format-money";

// Same limit as the server: numeric(10,2) holds 8 whole digits.
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];


/** Oldest-first split of `amount` across open invoices, capped at each one's outstanding. */
function autoAllocate(amount: string, open: { id: string; outstanding: string }[]): Record<string, string> {
  let left = MONEY.test(amount) ? toPaise(amount) : 0;
  const out: Record<string, string> = {};
  for (const inv of open) {
    const take = Math.min(left, toPaise(inv.outstanding));
    out[inv.id] = take > 0 ? fromPaise(take) : "";
    left -= take;
  }
  return out;
}

/**
 * Record payment — side panel. Splits the amount across open invoices oldest-first (editable);
 * anything not allocated stays as patient credit. One Idempotency-Key per opening, so a
 * double-click or a retry after a dropped connection never records the money twice.
 * When the patient already has credit, it can be applied to an invoice without new money.
 */
export function RecordPaymentPanel({
  patientId,
  ledger,
  open,
  onClose,
  onDone,
}: {
  patientId: string;
  ledger: PatientLedger | undefined;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { data: locationsData } = useQuery({ queryKey: ["locations"], queryFn: listLocations, enabled: open });
  const { data: suggestion } = useQuery({ queryKey: ["suggest-location", patientId, ""], queryFn: () => suggestLocation(patientId), enabled: open });

  const openInvoices = useMemo(
    () =>
      (ledger?.invoices ?? [])
        .filter((i) => i.status !== "void" && i.outstanding !== null && i.outstanding !== "0.00")
        .sort((a, b) => a.issued_at.localeCompare(b.issued_at))
        .map((i) => ({ id: i.id, number: i.invoice_number, outstanding: i.outstanding as string })),
    [ledger],
  );
  const credit = ledger?.credit ?? "0.00";

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [locationId, setLocationId] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [allocationsTouched, setAllocationsTouched] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [creditInvoiceId, setCreditInvoiceId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setAmount("");
      setMethod("upi");
      setLocationId(""); // fall back to this patient's suggested location again
      setReference("");
      setAllocations({});
      setAllocationsTouched(false);
      setIdempotencyKey(crypto.randomUUID());
      setCreditInvoiceId("");
      setCreditAmount("");
    }
  }
  const effectiveLocationId = locationId || (suggestion?.location_id ?? locationsData?.data[0]?.id ?? "");
  // Derived, not captured at open: the ledger may still be loading then, and the list can change.
  const effectiveCreditInvoiceId = openInvoices.some((i) => i.id === creditInvoiceId) ? creditInvoiceId : (openInvoices[0]?.id ?? "");

  const effectiveAllocations = allocationsTouched ? allocations : autoAllocate(amount, openInvoices);
  const allocated = addMoney(Object.values(effectiveAllocations).filter((v) => MONEY.test(v)));
  const toCredit = MONEY.test(amount) ? addMoney([amount, `-${allocated}`]) : "0.00";
  const overAllocated = MONEY.test(amount) && toCredit.startsWith("-");

  const payment = useMutation({
    mutationFn: () =>
      recordPayment(
        {
          patient_id: patientId,
          location_id: effectiveLocationId,
          amount,
          method,
          reference: reference || null,
          allocations: Object.entries(effectiveAllocations)
            .filter(([, v]) => MONEY.test(v) && toPaise(v) > 0)
            .map(([invoice_id, v]) => ({ invoice_id, amount: v })),
        },
        idempotencyKey,
      ),
    onSuccess: () => onDone(`${formatRupees(amount)} recorded.`),
  });

  const creditMutation = useMutation({
    mutationFn: () => applyCredit({ patient_id: patientId, invoice_id: effectiveCreditInvoiceId, amount: creditAmount }),
    onSuccess: () => onDone(`${formatRupees(creditAmount)} of credit applied.`),
  });

  const field = "h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel";

  return (
    <SidePanel open={open} onClose={onClose} title="Record payment">
      <div className="flex flex-col gap-4">
        {credit !== "0.00" && openInvoices.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-healthy/40 bg-paper p-3">
            <p className="text-[12px] text-ink">
              This patient has <span className="font-medium">{formatRupees(credit)}</span> credit. Apply it to an invoice:
            </p>
            <div className="flex gap-2">
              <select value={effectiveCreditInvoiceId} onChange={(e) => setCreditInvoiceId(e.target.value)} className={`${field} flex-1`} aria-label="Invoice to apply credit to">
                {openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} · {formatRupees(i.outstanding)} due
                  </option>
                ))}
              </select>
              <input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value.trim())} placeholder="Amount" inputMode="decimal" aria-label="Credit to apply" className={`${field} w-24 text-right font-data`} />
            </div>
            <button
              type="button"
              disabled={!MONEY.test(creditAmount) || !effectiveCreditInvoiceId || creditMutation.isPending}
              onClick={() => creditMutation.mutate()}
              className="h-7 self-start rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo disabled:opacity-50"
            >
              Apply credit
            </button>
            {creditMutation.isError && <p className="text-[12px] text-bleed">{(creditMutation.error as Error).message}</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">Amount</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" placeholder="0.00" className={`${field} font-data`} autoFocus />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={field}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI ref, cheque no." className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">Location</span>
            <select value={effectiveLocationId} onChange={(e) => setLocationId(e.target.value)} className={field}>
              {(locationsData?.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {openInvoices.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-soft">Apply to</span>
            <ul className="flex flex-col divide-y divide-rule rounded-[var(--radius)] border border-rule">
              {openInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px]">
                  <span className="text-ink">
                    {inv.number} <span className="text-ink-soft">· {formatRupees(inv.outstanding)} due</span>
                  </span>
                  <input
                    value={effectiveAllocations[inv.id] ?? ""}
                    onChange={(e) => {
                      setAllocations({ ...effectiveAllocations, [inv.id]: e.target.value.trim() });
                      setAllocationsTouched(true);
                    }}
                    inputMode="decimal"
                    aria-label={`Amount for ${inv.number}`}
                    className={`${field} h-7 w-24 text-right font-data`}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {MONEY.test(amount) && !overAllocated && toCredit !== "0.00" && (
          <p className="text-[12px] text-ink-soft">{formatRupees(toCredit)} will be kept as credit for this patient.</p>
        )}
        {overAllocated && <p className="text-[12px] text-bleed">The amounts applied add up to more than the payment.</p>}
        {payment.isError && <p className="text-[12px] text-bleed">{(payment.error as Error).message}</p>}

        <button
          type="button"
          disabled={!MONEY.test(amount) || toPaise(amount) <= 0 || overAllocated || !effectiveLocationId || payment.isPending}
          onClick={() => payment.mutate()}
          className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {payment.isPending ? "Recording…" : MONEY.test(amount) ? `Record ${formatRupees(amount)}` : "Record payment"}
        </button>
      </div>
    </SidePanel>
  );
}
