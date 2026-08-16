import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { patients } from "./_patients-base";
import { chartedProcedures } from "./clinical";

export const treatmentPlanStatus = pgEnum("treatment_plan_status", [
  "draft",
  "presented",
  "accepted",
  "declined",
  "completed",
]);

export const treatmentPlans = pgTable("treatment_plans", {
  ...tenantColumns(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  name: text("name").notNull(),
  status: treatmentPlanStatus("status").notNull().default("draft"),
  presentedAt: timestamp("presented_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  signatureImageKey: text("signature_image_key"),
});

export const treatmentPlanPhases = pgTable("treatment_plan_phases", {
  ...tenantColumns(),
  treatmentPlanId: uuid("treatment_plan_id")
    .notNull()
    .references(() => treatmentPlans.id),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull().default(0),
  note: text("note"),
});

// References a Charted Procedure — never copies tooth, surfaces, code, or price.
// See docs/adr/0002-charted-procedure-single-source-of-truth.md.
export const treatmentPlanItems = pgTable("treatment_plan_items", {
  ...tenantColumns(),
  treatmentPlanPhaseId: uuid("treatment_plan_phase_id")
    .notNull()
    .references(() => treatmentPlanPhases.id),
  chartedProcedureId: uuid("charted_procedure_id")
    .notNull()
    .references(() => chartedProcedures.id),
  sequence: integer("sequence").notNull().default(0),
});
