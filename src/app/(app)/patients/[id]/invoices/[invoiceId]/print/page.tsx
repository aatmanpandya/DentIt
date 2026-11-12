"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { getInvoice, type InvoiceLine } from "@/lib/ledger-api";
import { addMoney, formatRupees, fromPaise, toPaise } from "@/lib/format-money";

const TAX_LABEL: Record<InvoiceLine["tax_class"], string> = {
  exempt_healthcare: "Exempt",
  gst_5: "GST 5%",
  gst_18: "GST 18%",
};

// Every dental service is SAC 9993; the tax class decides the rate, not the code.
const SAC = "9993";

/** Intra-state GST as CGST + SGST, half each; the second half takes the odd paisa. */
function splitTax(tax: string) {
  const paise = toPaise(tax);
  const cgst = Math.floor(paise / 2);
  return { cgst: fromPaise(cgst), sgst: fromPaise(paise - cgst) };
}

/**
 * Printable invoice — replaces GET /invoices/:id/pdf (docs/specs/ledger.md, scope cuts):
 * same window.print() approach as the plan presentation page. A clinic that isn't
 * GST-registered gets a plain receipt; a registered one gets a tax invoice with GSTIN,
 * SAC, per-line tax and the CGST/SGST split per rate.
 */
export default function InvoicePrintPage() {
  const params = useParams<{ id: string; invoiceId: string }>();
  const { data: inv } = useQuery({ queryKey: ["invoice", params.invoiceId], queryFn: () => getInvoice(params.invoiceId) });

  if (!inv) return <div className="p-8 text-[13px] text-ink-soft">Loading…</div>;

  const taxInvoice = inv.organization.gst_registered;
  const loc = inv.location;
  const issued = new Date(inv.issued_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: inv.organization.timezone });
  const paid = addMoney(inv.allocations.map((a) => a.amount));
  const adjusted = addMoney(inv.adjustments.map((a) => a.amount));

  // Tax per rate for the footer, from the snapshotted lines.
  const byRate = new Map<string, string>();
  for (const line of inv.lines) {
    if (toPaise(line.tax_amount) === 0) continue;
    byRate.set(line.tax_rate, addMoney([byRate.get(line.tax_rate) ?? "0", line.tax_amount]));
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10 text-[13px] text-ink print:px-0 print:py-0">
      <div className="mb-6 flex justify-end print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-rule px-3 text-[12px] font-medium text-ink hover:bg-steel-lo"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      {inv.status === "void" && (
        <div className="mb-4 rounded-[var(--radius)] border border-bleed px-3 py-2 text-[12px] font-medium text-bleed">
          VOID — {inv.void_reason}
        </div>
      )}

      <header className="flex items-start justify-between border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-[18px] font-medium">{inv.organization.name}</h1>
          {loc && (
            <p className="mt-1 text-[12px] text-ink-soft">
              {loc.name}
              {loc.address_line1 && <>, {loc.address_line1}</>}
              {loc.city && <>, {loc.city}</>}
              {loc.postal_code && <> {loc.postal_code}</>}
              {loc.phone && <> · {loc.phone}</>}
            </p>
          )}
          {taxInvoice && inv.organization.gstin && <p className="mt-0.5 font-data text-[12px]">GSTIN {inv.organization.gstin}</p>}
        </div>
        <div className="text-right">
          <p className="text-[15px] font-medium">{taxInvoice ? "Tax invoice" : "Receipt"}</p>
          <p className="font-data">{inv.invoice_number}</p>
          <p className="text-[12px] text-ink-soft">{issued}</p>
        </div>
      </header>

      <section className="mt-4 text-[12px]">
        <p className="text-ink-soft">Patient</p>
        <p className="font-medium">
          {inv.patient.first_name} {inv.patient.last_name} <span className="font-data font-normal text-ink-soft">· {inv.patient.patient_number}</span>
        </p>
        {inv.responsible_party && (
          <p className="text-ink-soft">
            Bill to: {inv.responsible_party.full_name} ({inv.responsible_party.relationship})
          </p>
        )}
      </section>

      <table className="mt-6 w-full border-collapse text-[12px]">
        <thead className="border-b border-ink text-left">
          <tr>
            <th className="py-1.5 font-medium">Treatment</th>
            {taxInvoice && <th className="py-1.5 font-medium">SAC</th>}
            {taxInvoice && <th className="py-1.5 text-right font-medium">Base price</th>}
            {taxInvoice && <th className="py-1.5 text-right font-medium">Tax</th>}
            <th className="py-1.5 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((line) => (
            <tr key={line.id} className="border-b border-rule">
              <td className="py-1.5">{line.description}</td>
              {taxInvoice && <td className="py-1.5 font-data">{SAC}</td>}
              {taxInvoice && <td className="py-1.5 text-right font-data">{formatRupees(line.unit_price)}</td>}
              {taxInvoice && (
                <td className="py-1.5 text-right font-data">
                  {TAX_LABEL[line.tax_class]} {toPaise(line.tax_amount) > 0 && <>· {formatRupees(line.tax_amount)}</>}
                </td>
              )}
              <td className="py-1.5 text-right font-data">{formatRupees(line.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 ml-auto flex w-72 flex-col gap-1 text-[12px]">
        {taxInvoice && (
          <>
            <Row label="Subtotal" value={formatRupees(inv.subtotal)} />
            {[...byRate.entries()].map(([rate, tax]) => {
              const half = fromPaise(toPaise(rate) / 2);
              const { cgst, sgst } = splitTax(tax);
              return (
                <div key={rate}>
                  <Row label={`CGST ${half}%`} value={formatRupees(cgst)} />
                  <Row label={`SGST ${half}%`} value={formatRupees(sgst)} />
                </div>
              );
            })}
          </>
        )}
        <div className="border-t border-ink pt-1">
          <Row label="Total" value={formatRupees(inv.total)} strong />
        </div>
        {toPaise(adjusted) !== 0 && <Row label="Adjustments" value={formatRupees(adjusted)} />}
        {toPaise(paid) > 0 && <Row label="Paid" value={formatRupees(`-${paid}`)} />}
        {inv.outstanding !== null && <Row label="Balance due" value={formatRupees(inv.outstanding)} strong />}
      </div>

      {!taxInvoice && <p className="mt-8 text-[11px] text-ink-soft">Healthcare services. Not a tax invoice.</p>}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={strong ? "font-medium" : "text-ink-soft"}>{label}</span>
      <span className={`font-data ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}
