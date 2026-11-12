"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Printer } from "lucide-react";
import { getInvoice, type InvoiceDetail, type InvoiceLine } from "@/lib/ledger-api";
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

function longDate(iso: string, timeZone: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone });
}

/**
 * Printable invoice / receipt — replaces GET /invoices/:id/pdf (docs/specs/ledger.md, scope
 * cuts); window.print() like the plan presentation page. The clinic's own identity (logo,
 * address, dentist) carries the page; a clinic that wasn't GST-registered when it issued the
 * invoice gets a plain receipt, a registered one a tax invoice (GSTIN, SAC, CGST/SGST).
 * Sized for A4.
 */
export default function InvoicePrintPage() {
  const params = useParams<{ id: string; invoiceId: string }>();
  const { data: inv, isError } = useQuery({ queryKey: ["invoice", params.invoiceId], queryFn: () => getInvoice(params.invoiceId) });

  if (isError) return <div className="p-8 text-[13px] text-bleed">This invoice couldn&apos;t be loaded.</div>;
  if (!inv)
    return (
      <div className="mx-auto mt-14 flex max-w-[794px] flex-col gap-4 bg-surface px-12 py-10 ring-1 ring-rule">
        <Skeleton className="h-14 w-48" />
        <Skeleton className="h-3 w-72" />
        <Skeleton className="mt-6 h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  return (
    <div className="min-h-full bg-paper px-6 py-8 print:bg-white print:p-0">
      {/* A4 with comfortable margins; the app chrome is already print:hidden. */}
      <style>{`@page { size: A4; margin: 14mm; }`}</style>

      <div className="mx-auto mb-4 flex max-w-[794px] justify-end print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
        >
          <Printer size={14} /> Print / save as PDF
        </button>
      </div>

      <article className="relative mx-auto max-w-[794px] bg-surface px-12 py-10 text-[12.5px] leading-relaxed text-ink shadow-sm ring-1 ring-rule print:max-w-none print:px-0 print:py-0 print:shadow-none print:ring-0">
        <Sheet inv={inv} />
      </article>
    </div>
  );
}

function Sheet({ inv }: { inv: InvoiceDetail }) {
  const org = inv.organization;
  const taxInvoice = org.gst_registered;
  const loc = inv.location;
  const isVoid = inv.status === "void";
  const outstanding = inv.outstanding ?? "0.00";
  const paidInFull = !isVoid && toPaise(outstanding) === 0;
  const paid = addMoney(inv.payments.map((p) => p.amount));
  const adjusted = addMoney(inv.adjustments.map((a) => a.amount));

  // Tax per rate for the footer, from the snapshotted lines.
  const byRate = new Map<string, string>();
  for (const line of inv.lines) {
    if (toPaise(line.tax_amount) === 0) continue;
    byRate.set(line.tax_rate, addMoney([byRate.get(line.tax_rate) ?? "0", line.tax_amount]));
  }

  const address = loc ? [loc.address_line1, loc.address_line2, [loc.city, loc.postal_code].filter(Boolean).join(" "), loc.state].filter(Boolean) : [];
  const dentist = inv.providers[0];

  return (
    <>
      {isVoid && (
        // Unmissable on screen and on paper: a voided invoice must never pass as a live one.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
          <span className="-rotate-[24deg] select-none text-[120px] font-bold tracking-widest text-bleed/15">VOID</span>
        </div>
      )}

      {/* Clinic identity and document reference */}
      <header className="flex items-start justify-between gap-8">
        <div className="max-w-[360px]">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a clinic-supplied asset of unknown size; next/image needs fixed dimensions
            <img src={org.logo_url} alt={org.name} className="mb-3 h-[60px] w-auto object-contain" />
          ) : (
            <h1 className="mb-2 text-[20px] font-semibold">{org.name}</h1>
          )}
          <address className="not-italic text-[11.5px] leading-snug text-ink-soft">
            {address.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div className="mt-1">
              {loc?.phone && <span>{formatPhone(loc.phone)}</span>}
              {loc?.phone && org.email && <span> · </span>}
              {org.email && <span>{org.email}</span>}
            </div>
            {taxInvoice && org.gstin && <div className="mt-1 font-data text-ink">GSTIN {org.gstin}</div>}
          </address>
        </div>

        <div className="text-right">
          <div className="text-[22px] font-semibold uppercase tracking-[0.12em]">{taxInvoice ? "Tax invoice" : "Receipt"}</div>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5 text-[11.5px]">
            <dt className="text-ink-soft">Number</dt>
            <dd className="font-data font-medium">{inv.invoice_number}</dd>
            <dt className="text-ink-soft">Date</dt>
            <dd>{longDate(inv.issued_at, org.timezone)}</dd>
          </dl>
          <span
            className={clsx(
              "mt-3 inline-block rounded-[var(--radius)] border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
              isVoid ? "border-bleed text-bleed" : paidInFull ? "border-healthy text-healthy" : "border-caution text-caution",
            )}
          >
            {isVoid ? "Void" : paidInFull ? "Paid" : `Balance due ${formatRupees(outstanding)}`}
          </span>
        </div>
      </header>

      {isVoid && (
        <p className="mt-5 rounded-[var(--radius)] border border-bleed/40 bg-bleed/5 px-3 py-2 text-[11.5px] text-bleed">
          This invoice was voided{inv.void_reason ? ` — ${inv.void_reason}` : ""}. It is kept for the record and is not payable.
        </p>
      )}

      {/* Who it's for, who treated */}
      <section className="mt-8 grid grid-cols-2 gap-8 border-y border-rule py-4 text-[12px]">
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-soft">Billed to</div>
          <div className="font-medium">
            {inv.patient.first_name} {inv.patient.last_name}
          </div>
          <div className="text-ink-soft">
            Patient no. <span className="font-data">{inv.patient.patient_number}</span>
            {inv.patient.phone && <> · {formatPhone(inv.patient.phone)}</>}
          </div>
          {inv.responsible_party && (
            <div className="mt-1 text-ink-soft">
              Payer: {inv.responsible_party.full_name} ({inv.responsible_party.relationship})
            </div>
          )}
        </div>
        {dentist && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-soft">
              {inv.providers.length > 1 ? "Treating dentists" : "Treating dentist"}
            </div>
            {inv.providers.map((p) => (
              <div key={p.full_name}>
                <span className="font-medium">{p.full_name}</span>
                {p.qualification && <span className="text-ink-soft">, {p.qualification}</span>}
                {p.registration_number && <div className="text-[11px] text-ink-soft">Reg. no. {p.registration_number}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Treatments */}
      <table className="mt-6 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b-2 border-ink text-left text-[10.5px] uppercase tracking-wider text-ink-soft">
            <th className="w-8 py-2 font-semibold">#</th>
            <th className="py-2 font-semibold">Treatment</th>
            {taxInvoice && <th className="py-2 font-semibold">SAC</th>}
            {taxInvoice && <th className="py-2 text-right font-semibold">Base price</th>}
            {taxInvoice && <th className="py-2 text-right font-semibold">Tax</th>}
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((line, i) => (
            <tr key={line.id} className="border-b border-rule">
              <td className="py-2.5 font-data text-ink-soft">{i + 1}</td>
              <td className="py-2.5">{line.description}</td>
              {taxInvoice && <td className="py-2.5 font-data">{SAC}</td>}
              {taxInvoice && <td className="py-2.5 text-right font-data">{formatRupees(line.unit_price)}</td>}
              {taxInvoice && (
                <td className="py-2.5 text-right font-data">
                  {TAX_LABEL[line.tax_class]}
                  {toPaise(line.tax_amount) > 0 && <> · {formatRupees(line.tax_amount)}</>}
                </td>
              )}
              <td className="py-2.5 text-right font-data">{formatRupees(line.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals, and the payments that make them up */}
      <section className="mt-5 flex items-start justify-between gap-10">
        <div className="min-w-0 flex-1 text-[11.5px]">
          {inv.payments.length > 0 && (
            <>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-soft">Payments received</div>
              <table className="w-full max-w-[340px] border-collapse">
                <tbody>
                  {inv.payments.map((p, i) => (
                    <tr key={i} className="border-b border-rule last:border-b-0">
                      <td className="py-1 text-ink-soft">{longDate(p.received_at, org.timezone)}</td>
                      <td className="py-1">
                        {p.method}
                        {p.reference && <span className="text-ink-soft"> · {p.reference}</span>}
                      </td>
                      <td className="py-1 text-right font-data">{formatRupees(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="w-72 flex-none text-[12px]">
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
          <div className={clsx(taxInvoice && "mt-1 border-t border-rule pt-1")}>
            <Row label="Total" value={formatRupees(inv.total)} strong />
          </div>
          {toPaise(adjusted) !== 0 && <Row label="Discounts & adjustments" value={formatRupees(adjusted)} />}
          {toPaise(paid) > 0 && <Row label="Paid" value={formatRupees(`-${paid}`)} />}
          {!isVoid && (
            <div className="mt-2 flex items-baseline justify-between rounded-[var(--radius)] bg-steel-lo px-3 py-2 print:bg-transparent print:px-0 print:border-t-2 print:border-ink">
              <span className="font-semibold">Balance due</span>
              <span className="font-data text-[15px] font-semibold">{formatRupees(outstanding)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Sign-off */}
      <footer className="mt-14 flex items-end justify-between gap-8">
        <div className="text-[11px] leading-snug text-ink-soft">
          <p className="text-[12px] text-ink">Thank you for choosing {org.name}.</p>
          <p className="mt-1">{taxInvoice ? "Healthcare services under SAC 9993." : "Healthcare services. This is a receipt, not a tax invoice."}</p>
        </div>
        {dentist && (
          <div className="w-56 text-center text-[11px]">
            <div className="mb-1 h-12 border-b border-ink" aria-hidden />
            <div className="font-medium text-ink">{dentist.full_name}</div>
            <div className="text-ink-soft">Authorised signatory</div>
          </div>
        )}
      </footer>

      <p className="mt-8 text-center text-[9.5px] text-ink-soft/70">Generated with DentIt</p>
    </>
  );
}

/** "+918160072704" → "+91 81600 72704"; anything else unchanged. */
function formatPhone(phone: string) {
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className={strong ? "font-semibold" : "text-ink-soft"}>{label}</span>
      <span className={clsx("font-data", strong && "font-semibold")}>{value}</span>
    </div>
  );
}
