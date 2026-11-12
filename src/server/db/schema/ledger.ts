import { boolean, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { tenantColumns } from "./_helpers";
import { locations } from "./locations";
import { patients, } from "./_patients-base";
import { responsibleParties } from "./patients";
import { chartedProcedures } from "./clinical";
import { taxClass } from "./catalog";

export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "void"]);

// Append-only. No PATCH endpoint exists — a wrong invoice is voided and reissued.
export const invoices = pgTable(
  "invoices",
  {
    ...tenantColumns(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    responsiblePartyId: uuid("responsible_party_id").references(() => responsibleParties.id),
    invoiceNumber: text("invoice_number").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    status: invoiceStatus("status").notNull().default("draft"),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 10, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    voidReason: text("void_reason"),
    // The clinic's GST status at issue, so a reprint matches what was issued even if the
    // clinic registers (or deregisters) later. docs/bug-log.md entry 28.
    gstRegistered: boolean("gst_registered").notNull().default(false),
    gstin: text("gstin"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
  },
  (t) => [uniqueIndex("invoices_org_number_idx").on(t.organizationId, t.invoiceNumber)],
);

export const invoiceLines = pgTable("invoice_lines", {
  ...tenantColumns(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  chartedProcedureId: uuid("charted_procedure_id").references(() => chartedProcedures.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  // Snapshotted per line — rates change over time, historical invoices must not.
  taxClass: taxClass("tax_class").notNull().default("exempt_healthcare"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 10, scale: 2 }).notNull(),
});

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "card",
  "upi",
  "bank_transfer",
  "cheque",
  "other",
]);

export const payments = pgTable("payments", {
  ...tenantColumns(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  method: paymentMethod("method").notNull(),
  reference: text("reference"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  receivedBy: uuid("received_by").notNull(), // -> users.id
  note: text("note"),
  // Idempotency-Key header (docs/specs/ledger.md): a repeat with the same key returns this
  // payment instead of recording the money twice; requestHash detects the same key reused
  // for a different request.
  idempotencyKey: text("idempotency_key"),
  requestHash: text("request_hash"),
}, (t) => [uniqueIndex("payments_org_idempotency_key_idx").on(t.organizationId, t.idempotencyKey)]);

export const paymentAllocations = pgTable("payment_allocations", {
  ...tenantColumns(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  // Sum of allocations must not exceed the payment — enforced in ledgerService, not the DB.
});

export const adjustmentType = pgEnum("adjustment_type", ["discount", "writeoff", "correction"]);

export const adjustments = pgTable("adjustments", {
  ...tenantColumns(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(), // signed
  reason: text("reason").notNull(),
  adjustmentType: adjustmentType("adjustment_type").notNull(),
});

// Per-organisation, per-calendar-year invoice sequence. Bumped with INSERT … ON CONFLICT DO
// UPDATE … RETURNING inside the invoice transaction, so concurrent creators serialise on the
// row lock and a rolled-back invoice releases its number. See docs/specs/ledger.md.
export const invoiceNumberCounters = pgTable(
  "invoice_number_counters",
  {
    ...tenantColumns(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull(),
  },
  (t) => [uniqueIndex("invoice_number_counters_org_year_idx").on(t.organizationId, t.year)],
);

// A payment recorded by mistake (wrong patient, wrong amount, never received) is reversed,
// never edited or deleted: one row here cancels it. The payment row stays as it was, so the
// ledger still shows what was recorded and when it was taken back. docs/specs/ledger.md.
export const paymentReversals = pgTable(
  "payment_reversals",
  {
    ...tenantColumns(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    reason: text("reason").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }).notNull(),
    reversedBy: uuid("reversed_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [uniqueIndex("payment_reversals_payment_idx").on(t.paymentId)],
);
