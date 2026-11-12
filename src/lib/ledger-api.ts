import { apiFetch } from "./api-client";

export type PaymentMethod = "cash" | "card" | "upi" | "bank_transfer" | "cheque" | "other";
export type InvoiceStatus = "draft" | "issued" | "void";

export interface Invoice {
  id: string;
  patient_id: string;
  location_id: string;
  responsible_party_id: string | null;
  invoice_number: string;
  issued_at: string;
  status: InvoiceStatus;
  subtotal: string;
  tax_total: string;
  total: string;
  void_reason: string | null;
  voided_at: string | null;
}

export interface InvoiceLine {
  id: string;
  charted_procedure_id: string | null;
  description: string;
  quantity: number;
  unit_price: string;
  tax_class: "exempt_healthcare" | "gst_5" | "gst_18";
  tax_rate: string;
  tax_amount: string;
  line_total: string;
}

export interface LedgerEntry {
  kind: "invoice" | "void" | "payment" | "adjustment" | "reversal";
  at: string;
  id: string;
  label: string;
  amount: string;
  balance: string;
  invoice_id: string | null;
  reversed: boolean; // payment entries: already reversed
}

export interface PatientLedger {
  balance: string;
  credit: string;
  entries: LedgerEntry[];
  invoices: (Invoice & { outstanding: string | null; paid: string })[];
}

export interface InvoiceableProcedure {
  id: string;
  procedure_code_id: string;
  code: string;
  short_name: string;
  tax_class: InvoiceLine["tax_class"];
  tooth: string | null;
  surfaces: string[] | null;
  quadrant: string | null;
  arch: string | null;
  completed_at: string | null;
  price: string | null;
  price_source: "snapshot" | "fee_schedule" | null;
}

export interface InvoiceDetail extends Invoice {
  outstanding: string | null;
  lines: InvoiceLine[];
  allocations: { id: string; payment_id: string; invoice_id: string; amount: string; created_at: string }[];
  adjustments: { id: string; invoice_id: string; amount: string; adjustment_type: string; reason: string; created_at: string }[];
  location: { id: string; name: string; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null; phone: string | null } | null;
  patient: { id: string; first_name: string; last_name: string; patient_number: string; phone: string };
  responsible_party: { full_name: string; relationship: string; phone: string } | null;
  organization: { name: string; gst_registered: boolean; gstin: string | null; timezone: string };
}

export interface OrganizationLedger {
  recent_invoices: (Invoice & { patient: { id: string; first_name: string; last_name: string; patient_number: string } | null })[];
  balances: { patient: { id: string; first_name: string; last_name: string; patient_number: string } | null; balance: string; credit: string }[];
}

export const getPatientLedger = (patientId: string) => apiFetch<PatientLedger>(`/patients/${patientId}/ledger`);
export const listInvoiceable = (patientId: string) => apiFetch<{ data: InvoiceableProcedure[] }>(`/patients/${patientId}/invoiceable`);
export const getInvoice = (id: string) => apiFetch<InvoiceDetail>(`/invoices/${id}`);
export const getOrganizationLedger = () => apiFetch<OrganizationLedger>("/ledger");

export function suggestLocation(patientId: string, chartedProcedureIds: string[] = []) {
  const ids = chartedProcedureIds.length ? `&charted_procedure_ids=${chartedProcedureIds.join(",")}` : "";
  return apiFetch<{ location_id: string | null; mixed: boolean }>(`/invoices/suggest-location?patient_id=${patientId}${ids}`);
}

export function createInvoice(input: { patient_id: string; location_id: string; charted_procedure_ids: string[]; prices?: Record<string, string> }) {
  return apiFetch<Invoice & { lines: InvoiceLine[] }>("/invoices", { method: "POST", body: JSON.stringify(input) });
}

export function voidInvoice(id: string, reason: string) {
  return apiFetch<Invoice>(`/invoices/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
}

/** `idempotencyKey` is generated once per panel opening, so a double-click or retry never records the money twice. */
export function recordPayment(
  input: { patient_id: string; location_id: string; amount: string; method: PaymentMethod; reference?: string | null; allocations?: { invoice_id: string; amount: string }[] },
  idempotencyKey: string,
) {
  return apiFetch("/payments", { method: "POST", body: JSON.stringify(input), headers: { "Idempotency-Key": idempotencyKey } });
}

export function applyCredit(input: { patient_id: string; invoice_id: string; amount: string }) {
  return apiFetch("/payments/apply-credit", { method: "POST", body: JSON.stringify(input) });
}

export function createAdjustment(input: { invoice_id: string; amount: string; adjustment_type: "discount" | "writeoff" | "correction"; reason: string }) {
  return apiFetch("/adjustments", { method: "POST", body: JSON.stringify(input) });
}

export function reversePayment(id: string, reason: string) {
  return apiFetch(`/payments/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
}
