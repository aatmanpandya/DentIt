"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { SidePanel } from "@/components/ui/side-panel";
import { listLocations } from "@/lib/schedule-api";
import { createInvoice, listInvoiceable, suggestLocation, type InvoiceableProcedure } from "@/lib/ledger-api";
import { addMoney, formatRupees, percentOf, toPaise } from "@/lib/format-money";

const MONEY = /^\d+(\.\d{1,2})?$/;

function where(p: InvoiceableProcedure): string {
  if (p.tooth) return `${p.tooth}${p.surfaces?.length ? ` ${p.surfaces.join("")}` : ""}`;
  return p.quadrant ?? (p.arch ? `${p.arch} arch` : "");
}

/**
 * Create invoice — side panel per ui-design.md. Lists this patient's completed, not yet
 * invoiced treatments. A price from an accepted plan is fixed; anything charted without a
 * plan is pre-filled from the fee schedule and editable (odontogram.md's pricing rule).
 */
export function CreateInvoicePanel({
  patientId,
  open,
  onClose,
  onCreated,
}: {
  patientId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (invoiceNumber: string, invoiceId: string) => void;
}) {
  const { data: invoiceable } = useQuery({ queryKey: ["invoiceable", patientId], queryFn: () => listInvoiceable(patientId), enabled: open });
  const { data: locationsData } = useQuery({ queryKey: ["locations"], queryFn: listLocations, enabled: open });
  const procedures = useMemo(() => invoiceable?.data ?? [], [invoiceable]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [locationId, setLocationId] = useState<string>("");
  const [locationTouched, setLocationTouched] = useState(false);
  // Discount at billing time: rupees off, or a percentage of the total.
  const [discountMode, setDiscountMode] = useState<"rupees" | "percent">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  // Fresh state each time the panel opens: everything ticked, prices pre-filled.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevProcedures, setPrevProcedures] = useState(procedures);
  if (open !== prevOpen || procedures !== prevProcedures) {
    setPrevOpen(open);
    setPrevProcedures(procedures);
    if (open) {
      setSelected(new Set(procedures.map((p) => p.id)));
      setPrices(Object.fromEntries(procedures.map((p) => [p.id, p.price ?? ""])));
      setLocationTouched(false);
      setDiscountValue("");
      setDiscountReason("");
    }
  }

  const selectedIds = useMemo(() => procedures.filter((p) => selected.has(p.id)).map((p) => p.id), [procedures, selected]);
  const { data: suggestion } = useQuery({
    queryKey: ["suggest-location", patientId, selectedIds.join(",")],
    queryFn: () => suggestLocation(patientId, selectedIds),
    enabled: open,
  });
  // The suggestion pre-fills the picker until the user chooses a location themselves.
  // Until the suggestion arrives, fall back to the first location rather than leaving the
  // Create button disabled for a beat.
  const effectiveLocationId = locationTouched ? locationId : (suggestion?.location_id ?? locationsData?.data[0]?.id ?? "");

  const chosen = procedures.filter((p) => selected.has(p.id));
  const missingPrice = chosen.filter((p) => !MONEY.test(prices[p.id] ?? ""));
  const total = addMoney(chosen.map((p) => (MONEY.test(prices[p.id] ?? "") ? prices[p.id] : "0")));
  const discountValid = discountValue === "" || (MONEY.test(discountValue) && (discountMode === "rupees" || toPaise(discountValue) <= 10_000));
  const discountAmount = discountValue && discountValid ? (discountMode === "percent" ? percentOf(total, discountValue) : addMoney([discountValue])) : "0.00";
  const hasDiscount = toPaise(discountAmount) > 0;
  const discountTooBig = toPaise(discountAmount) > toPaise(total);
  const patientPays = addMoney([total, `-${discountAmount}`]);

  const mutation = useMutation({
    mutationFn: () =>
      createInvoice({
        patient_id: patientId,
        location_id: effectiveLocationId,
        charted_procedure_ids: selectedIds,
        prices: Object.fromEntries(chosen.filter((p) => p.price_source !== "snapshot").map((p) => [p.id, prices[p.id]])),
        ...(hasDiscount ? { discount: { amount: discountAmount, reason: discountReason.trim() } } : {}),
      }),
    onSuccess: (invoice) => onCreated(invoice.invoice_number, invoice.id),
  });

  return (
    <SidePanel open={open} onClose={onClose} title="Create invoice">
      {procedures.length === 0 ? (
        <p className="text-[12px] text-ink-soft">
          Nothing to invoice. Treatments appear here once they&apos;re marked complete on the chart.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-rule rounded-[var(--radius)] border border-rule">
            {procedures.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-2.5 py-2 text-[12px]">
                <input
                  type="checkbox"
                  aria-label={`Include ${p.short_name}`}
                  checked={selected.has(p.id)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                <span className="flex-1 text-ink">
                  {p.short_name}
                  {where(p) && <span className="text-ink-soft"> · {where(p)}</span>}
                </span>
                {p.price_source === "snapshot" ? (
                  <span className="font-data text-ink" title="Agreed on an accepted treatment plan">
                    {formatRupees(p.price)}
                  </span>
                ) : (
                  <label className="flex items-center gap-1 font-data text-ink-soft">
                    ₹
                    <input
                      value={prices[p.id] ?? ""}
                      onChange={(e) => setPrices((prev) => ({ ...prev, [p.id]: e.target.value.trim() }))}
                      inputMode="decimal"
                      placeholder="Price"
                      aria-label={`Price for ${p.short_name}`}
                      className="h-7 w-24 rounded-[var(--radius)] border border-rule bg-surface px-1.5 text-right text-[12px] text-ink outline-none focus-visible:border-steel"
                    />
                  </label>
                )}
              </li>
            ))}
          </ul>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">Location</span>
            <select
              value={effectiveLocationId}
              onChange={(e) => {
                setLocationTouched(true);
                setLocationId(e.target.value);
              }}
              className="h-8 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink"
            >
              {(locationsData?.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {suggestion?.mixed && (
              <span className="text-[11px] text-caution">These treatments were done at more than one location — check this.</span>
            )}
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-soft">Discount (optional)</span>
            <div className="flex gap-2">
              <div className="flex overflow-hidden rounded-[var(--radius)] border border-rule" role="group" aria-label="Discount in">
                {(["percent", "rupees"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={discountMode === mode}
                    onClick={() => setDiscountMode(mode)}
                    className={clsx("h-8 px-2.5 text-[12px]", discountMode === mode ? "bg-steel text-white" : "bg-surface text-ink-soft hover:bg-steel-lo")}
                  >
                    {mode === "percent" ? "%" : "₹"}
                  </button>
                ))}
              </div>
              <input
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value.trim())}
                inputMode="decimal"
                placeholder={discountMode === "percent" ? "e.g. 10" : "e.g. 200"}
                aria-label="Discount amount"
                className="h-8 w-24 rounded-[var(--radius)] border border-rule bg-surface px-2 text-right font-data text-[12px] text-ink outline-none focus-visible:border-steel"
              />
              <input
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder="Reason, e.g. senior citizen"
                aria-label="Discount reason"
                className="h-8 min-w-0 flex-1 rounded-[var(--radius)] border border-rule bg-surface px-2 text-[12px] text-ink outline-none focus-visible:border-steel"
              />
            </div>
            {!discountValid && <span className="text-[11px] text-bleed">Enter a number{discountMode === "percent" ? " up to 100" : ""}.</span>}
          </div>

          <div className="flex flex-col gap-1 border-t border-rule pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-soft">Total</span>
              <span className={clsx("font-data text-ink", hasDiscount ? "text-[13px]" : "text-[15px] font-medium")}>{formatRupees(total)}</span>
            </div>
            {hasDiscount && (
              <>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-soft">Discount{discountMode === "percent" ? ` (${discountValue}%)` : ""}</span>
                  <span className="font-data text-healthy">−{formatRupees(discountAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-ink">Patient pays</span>
                  <span className="font-data text-[15px] font-medium text-ink">{formatRupees(patientPays)}</span>
                </div>
              </>
            )}
          </div>

          {discountTooBig && <p className="text-[12px] text-bleed">The discount is more than the total.</p>}
          {hasDiscount && !discountReason.trim() && <p className="text-[12px] text-ink-soft">Add a reason for the discount.</p>}
          {missingPrice.length > 0 && (
            <p className="text-[12px] text-bleed">Enter a price for {missingPrice.map((p) => p.short_name).join(", ")}.</p>
          )}
          {mutation.isError && <p className="text-[12px] text-bleed">{(mutation.error as Error).message}</p>}

          <button
            type="button"
            disabled={
              chosen.length === 0 ||
              missingPrice.length > 0 ||
              !effectiveLocationId ||
              !discountValid ||
              discountTooBig ||
              (hasDiscount && !discountReason.trim()) ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
            className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? "Creating…" : `Create invoice for ${formatRupees(total)}${hasDiscount ? ` (patient pays ${formatRupees(patientPays)})` : ""}`}
          </button>
        </div>
      )}
    </SidePanel>
  );
}
