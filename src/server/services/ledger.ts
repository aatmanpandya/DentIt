import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import {
  adjustments,
  appointments,
  chartedProcedures,
  invoiceLines,
  invoiceNumberCounters,
  invoices,
  locations,
  organizations,
  paymentAllocations,
  payments,
  patients,
  procedureCodes,
  responsibleParties,
  userLocationAccess,
} from "@/server/db/schema";
import { assertCan, PermissionDeniedError } from "@/server/lib/permissions";
import type { RequestActor } from "@/server/lib/request-auth";
import { fromPaise, lineTax, rateToPercentString, toPaise, TAX_RATE_BY_CLASS } from "@/server/lib/money";
import { zonedDateString } from "@/server/lib/timezone";
import { writeAudit } from "./audit";
import { resolvePrice, FeeScheduleNoPriceError } from "./catalog";
import { PatientNotFoundError } from "./patients";
import { LocationNotFoundError } from "./locations";
import { computeLedgerState, loadPatientLedgerRows, type LedgerRows, type LedgerState } from "./ledger-balance";

export { computeLedgerState, type LedgerState };

/**
 * Invoices, payments, allocations and adjustments — docs/specs/ledger.md. Append-only:
 * nothing here edits or deletes a ledger row (rls.sql revokes the grants too); a wrong
 * invoice is voided and reissued. Balances are computed from the rows, never stored.
 * All arithmetic is in integer paise via src/server/lib/money.ts.
 */

type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

export { PatientNotFoundError, LocationNotFoundError };

export class InvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice not found.");
    this.name = "InvoiceNotFoundError";
  }
}

export class ProcedureNotInvoiceableError extends Error {
  constructor() {
    super("Only this patient's completed treatments that aren't already on an invoice can be invoiced.");
    this.name = "ProcedureNotInvoiceableError";
  }
}

export class ProcedureNotPricedError extends Error {
  constructor(names: string[]) {
    super(`${names.join(", ")} ${names.length === 1 ? "has" : "have"} no price. Enter one to invoice it.`);
    this.name = "ProcedureNotPricedError";
  }
}

export class InvoiceAlreadyVoidError extends Error {
  constructor() {
    super("This invoice is already void.");
    this.name = "InvoiceAlreadyVoidError";
  }
}

export class PaymentExceedsBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentExceedsBalanceError";
  }
}

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("This payment was already submitted with different details. Refresh and try again.");
    this.name = "IdempotencyKeyReusedError";
  }
}

export class AdjustmentInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustmentInvalidError";
  }
}

/** Front desk voiding/adjusting an invoice from an earlier day. A 403 at the route. */
export class ChargeReductionNotAllowedError extends Error {
  constructor(action: "void" | "adjust") {
    super(
      action === "void"
        ? "Invoices from earlier days can only be voided by a manager."
        : "Invoices from earlier days can only be adjusted by a manager.",
    );
    this.name = "ChargeReductionNotAllowedError";
  }
}

// --- shared reads ---

async function requirePatient(tx: Tx, actor: RequestActor, patientId: string) {
  const [row] = await tx
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, actor.organizationId), isNull(patients.deletedAt)))
    .limit(1);
  if (!row) throw new PatientNotFoundError();
  return row;
}

async function requireLocation(tx: Tx, actor: RequestActor, locationId: string) {
  const [row] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw new LocationNotFoundError();
  return row;
}

async function requireInvoice(tx: Tx, actor: RequestActor, invoiceId: string, opts: { forUpdate?: boolean } = {}) {
  const query = tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, actor.organizationId), isNull(invoices.deletedAt)))
    .limit(1);
  const [row] = opts.forUpdate ? await query.for("update") : await query;
  if (!row) throw new InvoiceNotFoundError();
  return row;
}

async function loadOrganization(tx: Tx, actor: RequestActor) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.organizationId)).limit(1);
  return org;
}

function auditContext(actor: RequestActor) {
  return { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null };
}

/**
 * Voids and adjustments reduce what a patient owes. Managers may do it any time; front
 * desk only on the same calendar day (in the org's timezone) the invoice was issued.
 * docs/specs/ledger.md, "Who can do what".
 */
function assertCanReduceCharge(actor: RequestActor, invoice: typeof invoices.$inferSelect, timeZone: string, action: "void" | "adjust") {
  assertCan(actor.role, "invoices_payments", "write");
  if (actor.role === "owner" || actor.role === "admin" || actor.role === "accountant") return;
  if (actor.role === "front_desk" && zonedDateString(invoice.issuedAt, timeZone) === zonedDateString(new Date(), timeZone)) return;
  throw new ChargeReductionNotAllowedError(action);
}

// Balance math lives in ./ledger-balance (shared with the patient summary header).

// --- location suggestion ---

/**
 * Pre-fill for the location picker (docs/specs/ledger.md): the procedures' appointment
 * location, else the patient's most recent appointment's, else the user's only
 * accessible location, else the org's first. `mixed` when the procedures span locations.
 */
export async function suggestInvoiceLocation(actor: RequestActor, patientId: string, chartedProcedureIds: string[] = []) {
  assertCan(actor.role, "invoices_payments", "read");
  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);

    if (chartedProcedureIds.length) {
      const rows = await tx
        .select({ locationId: appointments.locationId, startsAt: appointments.startsAt })
        .from(chartedProcedures)
        .innerJoin(appointments, eq(appointments.id, chartedProcedures.appointmentId))
        .where(and(inArray(chartedProcedures.id, chartedProcedureIds), eq(chartedProcedures.patientId, patientId)))
        .orderBy(desc(appointments.startsAt));
      if (rows.length) {
        return { locationId: rows[0].locationId, mixed: new Set(rows.map((r) => r.locationId)).size > 1 };
      }
    }

    const [recent] = await tx
      .select({ locationId: appointments.locationId })
      .from(appointments)
      .where(and(eq(appointments.patientId, patientId), lte(appointments.startsAt, new Date()), isNull(appointments.deletedAt)))
      .orderBy(desc(appointments.startsAt))
      .limit(1);
    if (recent) return { locationId: recent.locationId, mixed: false };

    const access = await tx.select().from(userLocationAccess).where(eq(userLocationAccess.userId, actor.userId));
    if (access.length === 1) return { locationId: access[0].locationId, mixed: false };

    const [first] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.organizationId, actor.organizationId), eq(locations.isActive, true)))
      .orderBy(asc(locations.displayOrder), asc(locations.name))
      .limit(1);
    return { locationId: first?.id ?? null, mixed: false };
  });
}

// --- invoiceable procedures ---

export interface InvoiceableProcedure {
  procedure: typeof chartedProcedures.$inferSelect;
  procedureCode: typeof procedureCodes.$inferSelect;
  price: string | null; // snapshot, else the current fee schedule's, else null
  priceSource: "snapshot" | "fee_schedule" | null;
}

/** Completed procedures not yet on a (non-void) invoice — the Create invoice panel's list. */
export async function listInvoiceableProcedures(actor: RequestActor, patientId: string): Promise<InvoiceableProcedure[]> {
  assertCan(actor.role, "invoices_payments", "read");
  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);
    const rows = await tx
      .select({ procedure: chartedProcedures, procedureCode: procedureCodes })
      .from(chartedProcedures)
      .innerJoin(procedureCodes, eq(procedureCodes.id, chartedProcedures.procedureCodeId))
      .where(
        and(
          eq(chartedProcedures.patientId, patientId),
          eq(chartedProcedures.status, "completed"),
          isNull(chartedProcedures.deletedAt),
          isNull(chartedProcedures.supersededById),
        ),
      )
      .orderBy(asc(chartedProcedures.completedAt));

    const result: InvoiceableProcedure[] = [];
    for (const row of rows) {
      if (row.procedure.price !== null) {
        result.push({ ...row, price: row.procedure.price, priceSource: "snapshot" });
        continue;
      }
      try {
        const priced = await resolvePrice(tx, actor, { procedure_code_id: row.procedure.procedureCodeId });
        result.push({ ...row, price: priced.price, priceSource: "fee_schedule" });
      } catch (err) {
        if (!(err instanceof FeeScheduleNoPriceError)) throw err;
        result.push({ ...row, price: null, priceSource: null });
      }
    }
    return result;
  });
}

// --- create invoice ---

export interface CreateInvoiceInput {
  patient_id: string;
  location_id: string;
  charted_procedure_ids: string[];
  /** Price for a procedure with no accept-time snapshot, keyed by charted_procedure_id. */
  prices?: Record<string, string>;
}

function describeProcedure(code: typeof procedureCodes.$inferSelect, p: typeof chartedProcedures.$inferSelect): string {
  const where = p.tooth
    ? `${p.tooth}${p.surfaces?.length ? ` ${p.surfaces.join("")}` : ""}`
    : p.quadrant ?? (p.arch ? `${p.arch} arch` : null);
  return where ? `${code.shortName} · ${where}` : code.shortName;
}

/**
 * Allocates the next invoice number for (org, calendar year in the org's timezone). The
 * upsert takes a row lock held until the invoice transaction ends, so concurrent creators
 * queue rather than collide, and a rollback releases the number (no gaps).
 */
async function nextInvoiceNumber(tx: Tx, actor: RequestActor, timeZone: string, issuedAt: Date) {
  const year = Number(zonedDateString(issuedAt, timeZone).slice(0, 4));
  const [counter] = await tx
    .insert(invoiceNumberCounters)
    .values({ organizationId: actor.organizationId, year, lastValue: 1, createdBy: actor.userId })
    .onConflictDoUpdate({
      target: [invoiceNumberCounters.organizationId, invoiceNumberCounters.year],
      set: { lastValue: sql`${invoiceNumberCounters.lastValue} + 1`, updatedAt: new Date(), updatedBy: actor.userId },
    })
    .returning({ lastValue: invoiceNumberCounters.lastValue });
  return `INV-${year}-${String(counter.lastValue).padStart(4, "0")}`;
}

export async function createInvoice(actor: RequestActor, input: CreateInvoiceInput) {
  assertCan(actor.role, "invoices_payments", "write");
  const ids = [...new Set(input.charted_procedure_ids)];
  if (ids.length === 0) throw new ProcedureNotInvoiceableError();

  return dbForRequest(actor.organizationId, async (tx) => {
    const patient = await requirePatient(tx, actor, input.patient_id);
    await requireLocation(tx, actor, input.location_id);
    const org = await loadOrganization(tx, actor);

    // FOR UPDATE: two invoices racing for the same procedure queue here; the second
    // re-reads it as `invoiced` and is refused, so nothing is ever billed twice.
    const rows = await tx
      .select({ procedure: chartedProcedures, procedureCode: procedureCodes })
      .from(chartedProcedures)
      .innerJoin(procedureCodes, eq(procedureCodes.id, chartedProcedures.procedureCodeId))
      .where(and(inArray(chartedProcedures.id, ids), eq(chartedProcedures.organizationId, actor.organizationId)))
      .for("update", { of: chartedProcedures });
    if (
      rows.length !== ids.length ||
      rows.some((r) => r.procedure.patientId !== patient.id || r.procedure.status !== "completed" || r.procedure.deletedAt || r.procedure.supersededById)
    ) {
      throw new ProcedureNotInvoiceableError();
    }

    const priced = rows.map((r) => ({ ...r, price: r.procedure.price ?? input.prices?.[r.procedure.id] ?? null }));
    const unpriced = priced.filter((r) => r.price === null);
    if (unpriced.length) throw new ProcedureNotPricedError(unpriced.map((r) => describeProcedure(r.procedureCode, r.procedure)));

    const lines = priced.map((r) => {
      const rate = org.gstRegistered ? TAX_RATE_BY_CLASS[r.procedureCode.taxClass] : 0;
      const { unit, tax, total } = lineTax(toPaise(r.price as string), rate, org.pricesIncludeTax);
      return { ...r, rate, unit, tax, total };
    });

    const issuedAt = new Date();
    const invoiceNumber = await nextInvoiceNumber(tx, actor, org.timezone, issuedAt);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        organizationId: actor.organizationId,
        locationId: input.location_id,
        patientId: patient.id,
        responsiblePartyId: patient.responsiblePartyId,
        invoiceNumber,
        issuedAt,
        status: "issued",
        subtotal: fromPaise(lines.reduce((s, l) => s + l.unit, 0)),
        taxTotal: fromPaise(lines.reduce((s, l) => s + l.tax, 0)),
        total: fromPaise(lines.reduce((s, l) => s + l.total, 0)),
        createdBy: actor.userId,
      })
      .returning();

    const lineRows = await tx
      .insert(invoiceLines)
      .values(
        lines.map((l) => ({
          organizationId: actor.organizationId,
          invoiceId: invoice.id,
          chartedProcedureId: l.procedure.id,
          description: describeProcedure(l.procedureCode, l.procedure),
          quantity: 1,
          unitPrice: fromPaise(l.unit),
          taxClass: l.procedureCode.taxClass,
          taxRate: rateToPercentString(l.rate),
          taxAmount: fromPaise(l.tax),
          lineTotal: fromPaise(l.total),
          createdBy: actor.userId,
        })),
      )
      .returning();

    for (const l of lines) {
      await tx
        .update(chartedProcedures)
        .set({
          status: "invoiced",
          invoicedAt: issuedAt,
          // A price entered at invoicing is written back so procedure and line agree (ADR-0002).
          ...(l.procedure.price === null ? { price: l.price } : {}),
          updatedBy: actor.userId,
          updatedAt: issuedAt,
        })
        .where(eq(chartedProcedures.id, l.procedure.id));
    }

    await writeAudit(tx, auditContext(actor), { entityType: "invoice", entityId: invoice.id, action: "create", after: { invoice, lines: lineRows } });
    return { invoice, lines: lineRows };
  });
}

// --- void ---

export async function voidInvoice(actor: RequestActor, invoiceId: string, reason: string) {
  assertCan(actor.role, "invoices_payments", "write");
  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireInvoice(tx, actor, invoiceId, { forUpdate: true });
    if (before.status === "void") throw new InvoiceAlreadyVoidError();
    const org = await loadOrganization(tx, actor);
    assertCanReduceCharge(actor, before, org.timezone, "void");

    const now = new Date();
    const [after] = await tx
      .update(invoices)
      .set({ status: "void", voidReason: reason, voidedAt: now, voidedBy: actor.userId, updatedBy: actor.userId, updatedAt: now })
      .where(eq(invoices.id, invoiceId))
      .returning();

    // Procedures go back to `completed` so they can be reissued on a corrected invoice; the
    // voided invoice keeps its lines as the record of what was billed.
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    const procedureIds = lines.flatMap((l) => (l.chartedProcedureId ? [l.chartedProcedureId] : []));
    if (procedureIds.length) {
      await tx
        .update(chartedProcedures)
        .set({ status: "completed", invoicedAt: null, updatedBy: actor.userId, updatedAt: now })
        .where(and(inArray(chartedProcedures.id, procedureIds), eq(chartedProcedures.status, "invoiced")));
    }

    await writeAudit(tx, auditContext(actor), { entityType: "invoice", entityId: invoiceId, action: "void", before, after });
    return after;
  });
}

// --- payments ---

export interface AllocationInput {
  invoice_id: string;
  amount: string;
}

export interface RecordPaymentInput {
  patient_id: string;
  location_id: string;
  amount: string;
  method: (typeof payments.$inferSelect)["method"];
  reference?: string | null;
  note?: string | null;
  allocations?: AllocationInput[];
}

function requestHashOf(input: RecordPaymentInput): string {
  const canonical = JSON.stringify({
    patient_id: input.patient_id,
    location_id: input.location_id,
    amount: fromPaise(toPaise(input.amount)),
    method: input.method,
    reference: input.reference ?? null,
    note: input.note ?? null,
    allocations: (input.allocations ?? []).map((a) => ({ invoice_id: a.invoice_id, amount: fromPaise(toPaise(a.amount)) })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Checks allocations against live invoices' outstanding and the money available for them. */
function validateAllocations(state: LedgerState, rows: LedgerRows, allocations: AllocationInput[], available: number) {
  const invoiceById = new Map(rows.invoices.map((i) => [i.id, i]));
  const requested = new Map<string, number>();
  for (const a of allocations) {
    const amount = toPaise(a.amount);
    if (amount <= 0) throw new PaymentExceedsBalanceError("Allocation amounts must be more than zero.");
    const invoice = invoiceById.get(a.invoice_id);
    if (!invoice) throw new InvoiceNotFoundError();
    if (invoice.status === "void") throw new PaymentExceedsBalanceError(`${invoice.invoiceNumber} is void — nothing is owed on it.`);
    requested.set(a.invoice_id, (requested.get(a.invoice_id) ?? 0) + amount);
  }
  for (const [invoiceId, amount] of requested) {
    const outstanding = state.outstandingByInvoice.get(invoiceId) ?? 0;
    if (amount > outstanding) {
      const number = invoiceById.get(invoiceId)?.invoiceNumber;
      throw new PaymentExceedsBalanceError(`That's more than the ₹${fromPaise(outstanding)} outstanding on ${number}.`);
    }
  }
  const total = [...requested.values()].reduce((s, v) => s + v, 0);
  if (total > available) throw new PaymentExceedsBalanceError(`Allocations add up to ₹${fromPaise(total)}, more than the ₹${fromPaise(available)} available.`);
}

export async function recordPayment(actor: RequestActor, input: RecordPaymentInput, idempotencyKey?: string | null) {
  assertCan(actor.role, "invoices_payments", "write");
  const requestHash = idempotencyKey ? requestHashOf(input) : null;

  const replay = async () =>
    dbForRequest(actor.organizationId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.organizationId, actor.organizationId), eq(payments.idempotencyKey, idempotencyKey as string)))
        .limit(1);
      if (!existing) return null;
      if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      const allocations = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, existing.id));
      return { payment: existing, allocations, replayed: true as const };
    });

  if (idempotencyKey) {
    const earlier = await replay();
    if (earlier) return earlier;
  }

  try {
    return await dbForRequest(actor.organizationId, async (tx) => {
      await requirePatient(tx, actor, input.patient_id);
      await requireLocation(tx, actor, input.location_id);
      const amount = toPaise(input.amount);
      if (amount <= 0) throw new PaymentExceedsBalanceError("A payment must be more than zero.");

      const rows = await loadPatientLedgerRows(tx, actor, input.patient_id);
      validateAllocations(computeLedgerState(rows), rows, input.allocations ?? [], amount);

      const [payment] = await tx
        .insert(payments)
        .values({
          organizationId: actor.organizationId,
          locationId: input.location_id,
          patientId: input.patient_id,
          amount: fromPaise(amount),
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          // App clock, like invoices.issued_at — never the column's DB default. The ledger
          // orders events across tables by these, and the database clock (Docker VM) can
          // run milliseconds behind Node's: a payment made just after an invoice then sorted
          // before it (docs/bug-log.md entry 7).
          receivedAt: new Date(),
          receivedBy: actor.userId,
          idempotencyKey: idempotencyKey ?? null,
          requestHash,
          createdBy: actor.userId,
        })
        .returning();

      const allocations = input.allocations?.length
        ? await tx
            .insert(paymentAllocations)
            .values(
              input.allocations.map((a) => ({
                organizationId: actor.organizationId,
                paymentId: payment.id,
                invoiceId: a.invoice_id,
                amount: fromPaise(toPaise(a.amount)),
                createdBy: actor.userId,
              })),
            )
            .returning()
        : [];

      await writeAudit(tx, auditContext(actor), { entityType: "payment", entityId: payment.id, action: "create", after: { payment, allocations } });
      return { payment, allocations, replayed: false as const };
    });
  } catch (err) {
    // Two requests with the same key raced past the replay check; the unique index let one
    // through. Answer the loser with the winner's payment (or the reuse error).
    if (idempotencyKey && (err as { code?: string }).code === "23505") {
      const earlier = await replay();
      if (earlier) return earlier;
    }
    throw err;
  }
}

/** Allocates existing unallocated credit to an invoice, oldest payment first. No new money. */
export async function applyCredit(actor: RequestActor, input: { patient_id: string; invoice_id: string; amount: string }) {
  assertCan(actor.role, "invoices_payments", "write");
  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, input.patient_id);
    const rows = await loadPatientLedgerRows(tx, actor, input.patient_id);
    const state = computeLedgerState(rows);
    const amount = toPaise(input.amount);
    validateAllocations(state, rows, [{ invoice_id: input.invoice_id, amount: input.amount }], state.credit);

    let remaining = amount;
    const created: (typeof paymentAllocations.$inferSelect)[] = [];
    const oldestFirst = [...rows.payments].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    for (const payment of oldestFirst) {
      const available = state.creditByPayment.get(payment.id) ?? 0;
      if (available <= 0 || remaining === 0) continue;
      const take = Math.min(available, remaining);
      const [row] = await tx
        .insert(paymentAllocations)
        .values({ organizationId: actor.organizationId, paymentId: payment.id, invoiceId: input.invoice_id, amount: fromPaise(take), createdBy: actor.userId })
        .returning();
      created.push(row);
      remaining -= take;
    }

    await writeAudit(tx, auditContext(actor), { entityType: "payment_allocation", entityId: input.invoice_id, action: "create", after: { applied_credit: fromPaise(amount), allocations: created } });
    return created;
  });
}

// --- adjustments ---

export interface CreateAdjustmentInput {
  invoice_id: string;
  amount: string; // signed: a discount or write-off is negative
  adjustment_type: (typeof adjustments.$inferSelect)["adjustmentType"];
  reason: string;
}

export async function createAdjustment(actor: RequestActor, input: CreateAdjustmentInput) {
  assertCan(actor.role, "invoices_payments", "write");
  return dbForRequest(actor.organizationId, async (tx) => {
    const invoice = await requireInvoice(tx, actor, input.invoice_id, { forUpdate: true });
    if (invoice.status === "void") throw new AdjustmentInvalidError("This invoice is void — nothing to adjust.");
    const org = await loadOrganization(tx, actor);
    assertCanReduceCharge(actor, invoice, org.timezone, "adjust");

    const amount = toPaise(input.amount);
    if (amount === 0) throw new AdjustmentInvalidError("An adjustment can't be zero.");
    const rows = await loadPatientLedgerRows(tx, actor, invoice.patientId);
    const outstanding = computeLedgerState(rows).outstandingByInvoice.get(invoice.id) ?? 0;
    if (outstanding + amount < 0) {
      throw new AdjustmentInvalidError(`That's more than the ₹${fromPaise(outstanding)} outstanding on ${invoice.invoiceNumber}.`);
    }

    const [row] = await tx
      .insert(adjustments)
      .values({
        organizationId: actor.organizationId,
        invoiceId: invoice.id,
        amount: fromPaise(amount),
        adjustmentType: input.adjustment_type,
        reason: input.reason,
        createdAt: new Date(), // app clock; see receivedAt in recordPayment
        createdBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, auditContext(actor), { entityType: "adjustment", entityId: row.id, action: "create", after: row });
    return row;
  });
}

// --- reads ---

export async function getInvoice(actor: RequestActor, invoiceId: string) {
  assertCan(actor.role, "invoices_payments", "read");
  return dbForRequest(actor.organizationId, async (tx) => {
    const invoice = await requireInvoice(tx, actor, invoiceId);
    const [lines, location, patient, org] = await Promise.all([
      tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.createdAt)),
      tx.select().from(locations).where(eq(locations.id, invoice.locationId)).then((r) => r[0]),
      tx.select().from(patients).where(eq(patients.id, invoice.patientId)).then((r) => r[0]),
      loadOrganization(tx, actor),
    ]);
    const responsibleParty = invoice.responsiblePartyId
      ? (await tx.select().from(responsibleParties).where(eq(responsibleParties.id, invoice.responsiblePartyId)))[0] ?? null
      : null;
    const rows = await loadPatientLedgerRows(tx, actor, invoice.patientId);
    const state = computeLedgerState(rows);
    return {
      invoice,
      lines,
      location,
      patient,
      responsibleParty,
      organization: { name: org.name, gstRegistered: org.gstRegistered, gstin: org.gstin, timezone: org.timezone },
      allocations: rows.allocations.filter((a) => a.invoiceId === invoiceId),
      adjustments: rows.adjustments.filter((a) => a.invoiceId === invoiceId),
      outstanding: invoice.status === "void" ? null : fromPaise(state.outstandingByInvoice.get(invoiceId) ?? 0),
    };
  });
}

const METHOD_LABEL: Record<(typeof payments.$inferSelect)["method"], string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

export type LedgerEntryKind = "invoice" | "void" | "payment" | "adjustment";

export interface LedgerEntry {
  kind: LedgerEntryKind;
  at: Date;
  id: string;
  label: string;
  amount: string; // signed effect on the balance
  balance: string; // running balance after this entry
  invoiceId: string | null;
}

/** Patient Ledger tab: date-ordered entries with a running balance, plus open invoices and credit. */
export async function getPatientLedger(actor: RequestActor, patientId: string) {
  assertCan(actor.role, "invoices_payments", "read");
  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);
    const rows = await loadPatientLedgerRows(tx, actor, patientId);
    const state = computeLedgerState(rows);
    const invoiceById = new Map(rows.invoices.map((i) => [i.id, i]));

    const raw: Omit<LedgerEntry, "balance">[] = [];
    for (const inv of rows.invoices) {
      raw.push({ kind: "invoice", at: inv.issuedAt, id: inv.id, label: inv.invoiceNumber, amount: inv.total, invoiceId: inv.id });
      if (inv.status === "void" && inv.voidedAt) {
        const adjustmentsOnIt = rows.adjustments.filter((a) => a.invoiceId === inv.id).reduce((s, a) => s + toPaise(a.amount), 0);
        raw.push({ kind: "void", at: inv.voidedAt, id: `${inv.id}:void`, label: `${inv.invoiceNumber} voided — ${inv.voidReason ?? ""}`.trim(), amount: fromPaise(-(toPaise(inv.total) + adjustmentsOnIt)), invoiceId: inv.id });
      }
    }
    for (const adj of rows.adjustments) {
      raw.push({ kind: "adjustment", at: adj.createdAt, id: adj.id, label: `${adj.adjustmentType} on ${invoiceById.get(adj.invoiceId)?.invoiceNumber ?? ""} — ${adj.reason}`, amount: adj.amount, invoiceId: adj.invoiceId });
    }
    for (const p of rows.payments) {
      raw.push({ kind: "payment", at: p.receivedAt, id: p.id, label: `Payment · ${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ""}`, amount: fromPaise(-toPaise(p.amount)), invoiceId: null });
    }
    // Ties (same instant, e.g. seeded rows) keep a stable, readable order: charges before payments.
    const order: Record<LedgerEntryKind, number> = { invoice: 0, adjustment: 1, void: 2, payment: 3 };
    raw.sort((a, b) => a.at.getTime() - b.at.getTime() || order[a.kind] - order[b.kind]);

    let running = 0;
    const entries: LedgerEntry[] = raw.map((e) => {
      running += toPaise(e.amount);
      return { ...e, balance: fromPaise(running) };
    });

    return {
      entries,
      invoices: rows.invoices
        .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
        .map((inv) => ({ invoice: inv, outstanding: inv.status === "void" ? null : fromPaise(state.outstandingByInvoice.get(inv.id) ?? 0) })),
      balance: fromPaise(state.balance),
      credit: fromPaise(state.credit),
    };
  });
}

const ORG_LEDGER_RECENT_LIMIT = 50;

/** /ledger page: recent invoices and every patient with a non-zero balance. */
export async function getOrganizationLedger(actor: RequestActor) {
  assertCan(actor.role, "invoices_payments", "read");
  return dbForRequest(actor.organizationId, async (tx) => {
    const patientName = { id: patients.id, firstName: patients.firstName, lastName: patients.lastName, patientNumber: patients.patientNumber };
    const recent = await tx
      .select({ invoice: invoices, patient: patientName })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(and(eq(invoices.organizationId, actor.organizationId), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.issuedAt))
      .limit(ORG_LEDGER_RECENT_LIMIT);

    // Pilot scale (one clinic, hundreds of rows): compute every patient's balance in memory
    // through the same computeLedgerState the patient tab uses.
    const [allInvoices, allPayments, allAllocations, allAdjustments] = await Promise.all([
      tx.select().from(invoices).where(and(eq(invoices.organizationId, actor.organizationId), isNull(invoices.deletedAt))),
      tx.select().from(payments).where(and(eq(payments.organizationId, actor.organizationId), isNull(payments.deletedAt))),
      tx.select().from(paymentAllocations).where(eq(paymentAllocations.organizationId, actor.organizationId)),
      tx.select().from(adjustments).where(eq(adjustments.organizationId, actor.organizationId)),
    ]);
    const patientIds = [...new Set([...allInvoices.map((i) => i.patientId), ...allPayments.map((p) => p.patientId)])];
    const invoicePatient = new Map(allInvoices.map((i) => [i.id, i.patientId]));
    const paymentPatient = new Map(allPayments.map((p) => [p.id, p.patientId]));

    const balances: { patientId: string; balance: string; credit: string }[] = [];
    for (const patientId of patientIds) {
      const state = computeLedgerState({
        invoices: allInvoices.filter((i) => i.patientId === patientId),
        payments: allPayments.filter((p) => p.patientId === patientId),
        allocations: allAllocations.filter((a) => paymentPatient.get(a.paymentId) === patientId),
        adjustments: allAdjustments.filter((a) => invoicePatient.get(a.invoiceId) === patientId),
      });
      if (state.balance !== 0) balances.push({ patientId, balance: fromPaise(state.balance), credit: fromPaise(state.credit) });
    }
    const names = patientIds.length
      ? await tx.select(patientName).from(patients).where(inArray(patients.id, patientIds))
      : [];
    const nameById = new Map(names.map((n) => [n.id, n]));
    balances.sort((a, b) => toPaise(b.balance) - toPaise(a.balance));

    return {
      recentInvoices: recent,
      balances: balances.map((b) => ({ ...b, patient: nameById.get(b.patientId) ?? null })),
    };
  });
}

export { PermissionDeniedError };
