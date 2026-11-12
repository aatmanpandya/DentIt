import type { adjustments, invoiceLines, invoices, locations, paymentAllocations, payments } from "@/server/db/schema";
import type { InvoiceableProcedure, LedgerEntry, getInvoice, getOrganizationLedger, getPatientLedger } from "@/server/services/ledger";

// snake_case in JSON, money as decimal strings, dates ISO 8601 — docs/specs/api-surface.md.

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function serializeInvoice(inv: typeof invoices.$inferSelect) {
  return {
    id: inv.id,
    patient_id: inv.patientId,
    location_id: inv.locationId,
    responsible_party_id: inv.responsiblePartyId,
    invoice_number: inv.invoiceNumber,
    issued_at: inv.issuedAt.toISOString(),
    status: inv.status,
    subtotal: inv.subtotal,
    tax_total: inv.taxTotal,
    total: inv.total,
    void_reason: inv.voidReason,
    voided_at: iso(inv.voidedAt),
  };
}

export function serializeInvoiceLine(line: typeof invoiceLines.$inferSelect) {
  return {
    id: line.id,
    charted_procedure_id: line.chartedProcedureId,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    tax_class: line.taxClass,
    tax_rate: line.taxRate,
    tax_amount: line.taxAmount,
    line_total: line.lineTotal,
  };
}

export function serializePayment(p: typeof payments.$inferSelect) {
  return {
    id: p.id,
    patient_id: p.patientId,
    location_id: p.locationId,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    note: p.note,
    received_at: p.receivedAt.toISOString(),
  };
}

export function serializeAllocation(a: typeof paymentAllocations.$inferSelect) {
  return { id: a.id, payment_id: a.paymentId, invoice_id: a.invoiceId, amount: a.amount, created_at: a.createdAt.toISOString() };
}

export function serializeAdjustment(a: typeof adjustments.$inferSelect) {
  return {
    id: a.id,
    invoice_id: a.invoiceId,
    amount: a.amount,
    adjustment_type: a.adjustmentType,
    reason: a.reason,
    created_at: a.createdAt.toISOString(),
  };
}

function serializeLocation(l: typeof locations.$inferSelect) {
  return { id: l.id, name: l.name, address_line1: l.addressLine1, address_line2: l.addressLine2, city: l.city, state: l.state, postal_code: l.postalCode, phone: l.phone };
}

export function serializeInvoiceDetail(d: Awaited<ReturnType<typeof getInvoice>>) {
  return {
    ...serializeInvoice(d.invoice),
    outstanding: d.outstanding,
    lines: d.lines.map(serializeInvoiceLine),
    allocations: d.allocations.map(serializeAllocation),
    adjustments: d.adjustments.map(serializeAdjustment),
    location: d.location ? serializeLocation(d.location) : null,
    patient: { id: d.patient.id, first_name: d.patient.firstName, last_name: d.patient.lastName, patient_number: d.patient.patientNumber, phone: d.patient.phone },
    responsible_party: d.responsibleParty
      ? { full_name: d.responsibleParty.fullName, relationship: d.responsibleParty.relationship, phone: d.responsibleParty.phone }
      : null,
    organization: { name: d.organization.name, gst_registered: d.organization.gstRegistered, gstin: d.organization.gstin, timezone: d.organization.timezone },
  };
}

function serializeEntry(e: LedgerEntry) {
  return { kind: e.kind, at: e.at.toISOString(), id: e.id, label: e.label, amount: e.amount, balance: e.balance, invoice_id: e.invoiceId };
}

export function serializePatientLedger(l: Awaited<ReturnType<typeof getPatientLedger>>) {
  return {
    balance: l.balance,
    credit: l.credit,
    entries: l.entries.map(serializeEntry),
    invoices: l.invoices.map((i) => ({ ...serializeInvoice(i.invoice), outstanding: i.outstanding })),
  };
}

export function serializeInvoiceable(r: InvoiceableProcedure) {
  return {
    id: r.procedure.id,
    procedure_code_id: r.procedure.procedureCodeId,
    code: r.procedureCode.code,
    short_name: r.procedureCode.shortName,
    tax_class: r.procedureCode.taxClass,
    tooth: r.procedure.tooth,
    surfaces: r.procedure.surfaces,
    quadrant: r.procedure.quadrant,
    arch: r.procedure.arch,
    completed_at: iso(r.procedure.completedAt),
    price: r.price,
    price_source: r.priceSource,
  };
}

export function serializeOrganizationLedger(o: Awaited<ReturnType<typeof getOrganizationLedger>>) {
  const name = (p: { id: string; firstName: string; lastName: string; patientNumber: string } | null) =>
    p ? { id: p.id, first_name: p.firstName, last_name: p.lastName, patient_number: p.patientNumber } : null;
  return {
    recent_invoices: o.recentInvoices.map((r) => ({ ...serializeInvoice(r.invoice), patient: name(r.patient) })),
    balances: o.balances.map((b) => ({ patient: name(b.patient), balance: b.balance, credit: b.credit })),
  };
}
