import { sql } from "drizzle-orm";
import { check, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { patients } from "./_patients-base";
import { chartedProcedures } from "./clinical";
import { procedureCodes } from "./catalog";

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

// Two mutually-exclusive sources per item — see docs/specs/treatment-planning.md's
// "Adding a treatment without charting first" and docs/adr/0002-charted-procedure-
// single-source-of-truth.md.
//
// Linked (chartedProcedureId set): references an existing Charted Procedure — never
// copies tooth, surfaces, code, or price, per ADR-0002.
//
// Deferred (procedureCodeId set, chartedProcedureId null): a treatment jotted onto
// the plan before anything is charted — no Odontogram entry required to draft a
// plan. Promoted into a real charted_procedure (and these columns cleared) the
// moment the plan is accepted, so ADR-0002's invariant still holds for anything
// that reaches real clinical commitment; a plan that's only ever drafted or
// declined never needs a matching chart entry.
export const treatmentPlanItems = pgTable(
  "treatment_plan_items",
  {
    ...tenantColumns(),
    treatmentPlanPhaseId: uuid("treatment_plan_phase_id")
      .notNull()
      .references(() => treatmentPlanPhases.id),
    chartedProcedureId: uuid("charted_procedure_id").references(() => chartedProcedures.id),
    procedureCodeId: uuid("procedure_code_id").references(() => procedureCodes.id),
    tooth: text("tooth"),
    surfaces: text("surfaces").array(),
    quadrant: text("quadrant"),
    arch: text("arch"),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [
    check(
      "treatment_plan_items_source_xor_check",
      sql`(${t.chartedProcedureId} IS NOT NULL) <> (${t.procedureCodeId} IS NOT NULL)`,
    ),
  ],
);
