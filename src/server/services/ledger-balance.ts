import { and, eq, inArray, isNull } from "drizzle-orm";
import type { dbForRequest } from "@/server/db/tenant";
import { adjustments, invoices, paymentAllocations, payments } from "@/server/db/schema";
import type { RequestActor } from "@/server/lib/request-auth";
import { toPaise } from "@/server/lib/money";

/**
 * The one balance calculation (docs/specs/ledger.md, "Shape of the ledger"), used by the
 * Ledger tab, the org ledger and the patient header summary so they can never disagree.
 * Kept apart from ./ledger so the patients service can use it without an import cycle
 * (ledger imports PatientNotFoundError from patients).
 */

type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

export interface LedgerRows {
  invoices: (typeof invoices.$inferSelect)[];
  allocations: (typeof paymentAllocations.$inferSelect)[];
  adjustments: (typeof adjustments.$inferSelect)[];
  payments: (typeof payments.$inferSelect)[];
}

export interface LedgerState {
  outstandingByInvoice: Map<string, number>; // paise; void invoices are absent
  creditByPayment: Map<string, number>; // paise not allocated to a non-void invoice
  owed: number;
  paid: number;
  balance: number; // owed − paid; negative = credit
  credit: number; // Σ unallocated credit
}

export function computeLedgerState(rows: LedgerRows): LedgerState {
  const live = new Set(rows.invoices.filter((i) => i.status !== "void").map((i) => i.id));
  const outstandingByInvoice = new Map<string, number>();
  let owed = 0;
  for (const inv of rows.invoices) {
    if (!live.has(inv.id)) continue;
    outstandingByInvoice.set(inv.id, toPaise(inv.total));
    owed += toPaise(inv.total);
  }
  for (const adj of rows.adjustments) {
    if (!live.has(adj.invoiceId)) continue;
    outstandingByInvoice.set(adj.invoiceId, (outstandingByInvoice.get(adj.invoiceId) ?? 0) + toPaise(adj.amount));
    owed += toPaise(adj.amount);
  }
  const creditByPayment = new Map<string, number>(rows.payments.map((p) => [p.id, toPaise(p.amount)]));
  for (const alloc of rows.allocations) {
    if (!live.has(alloc.invoiceId)) continue; // allocations to a void invoice turn back into credit
    outstandingByInvoice.set(alloc.invoiceId, (outstandingByInvoice.get(alloc.invoiceId) ?? 0) - toPaise(alloc.amount));
    creditByPayment.set(alloc.paymentId, (creditByPayment.get(alloc.paymentId) ?? 0) - toPaise(alloc.amount));
  }
  const paid = rows.payments.reduce((sum, p) => sum + toPaise(p.amount), 0);
  const credit = [...creditByPayment.values()].reduce((sum, c) => sum + c, 0);
  return { outstandingByInvoice, creditByPayment, owed, paid, balance: owed - paid, credit };
}

export async function loadPatientLedgerRows(tx: Tx, actor: RequestActor, patientId: string): Promise<LedgerRows> {
  const invoiceRows = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.patientId, patientId), eq(invoices.organizationId, actor.organizationId), isNull(invoices.deletedAt)));
  const invoiceIds = invoiceRows.map((i) => i.id);
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.patientId, patientId), eq(payments.organizationId, actor.organizationId), isNull(payments.deletedAt)));
  const paymentIds = paymentRows.map((p) => p.id);
  const allocationRows = paymentIds.length
    ? await tx.select().from(paymentAllocations).where(inArray(paymentAllocations.paymentId, paymentIds))
    : [];
  const adjustmentRows = invoiceIds.length
    ? await tx.select().from(adjustments).where(inArray(adjustments.invoiceId, invoiceIds))
    : [];
  return { invoices: invoiceRows, allocations: allocationRows, adjustments: adjustmentRows, payments: paymentRows };
}

