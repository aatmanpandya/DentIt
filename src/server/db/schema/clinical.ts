import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { patients } from "./_patients-base";
import { procedureCodes, feeSchedules } from "./catalog";
import { appointments } from "./scheduling";

export const chartedConditions = pgTable("charted_conditions", {
  ...tenantColumns(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  tooth: text("tooth"), // FDI code — see docs/adr/0003-fdi-canonical-tooth-notation.md
  surfaces: text("surfaces").array(),
  conditionType: text("condition_type").notNull(),
  note: text("note"),
  chartedBy: uuid("charted_by").notNull(), // -> users.id
  chartedAt: timestamp("charted_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// See docs/adr/0002-charted-procedure-single-source-of-truth.md — the single source of
// truth shared by the odontogram, treatment planning, and the ledger.
export const chartedProcedureStatus = pgEnum("charted_procedure_status", [
  "planned",
  "accepted",
  "scheduled",
  "completed",
  "invoiced",
  "cancelled",
]);

export const chartedProcedures = pgTable(
  "charted_procedures",
  {
    ...tenantColumns(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    procedureCodeId: uuid("procedure_code_id")
      .notNull()
      .references(() => procedureCodes.id),
    tooth: text("tooth"),
    surfaces: text("surfaces").array(),
    quadrant: text("quadrant"),
    arch: text("arch"),
    status: chartedProcedureStatus("status").notNull().default("planned"),
    providerId: uuid("provider_id"), // -> users.id
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    price: numeric("price", { precision: 10, scale: 2 }), // snapshot at acceptance
    feeScheduleId: uuid("fee_schedule_id").references(() => feeSchedules.id),
    note: text("note"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    // Amendment after `invoiced` inserts a new row and points the old one here. Never mutate
    // an invoiced procedure in place — see ADR-0002.
    supersededById: uuid("superseded_by_id"),
  },
  (t) => [index("charted_procedures_patient_status_idx").on(t.patientId, t.status)],
);

export const clinicalNotes = pgTable("clinical_notes", {
  ...tenantColumns(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  providerId: uuid("provider_id").notNull(), // -> users.id
  body: text("body").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signedBy: uuid("signed_by"), // -> users.id
  amendsNoteId: uuid("amends_note_id"),
});
