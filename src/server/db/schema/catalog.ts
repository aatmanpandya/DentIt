import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { locations } from "./locations";
import { organizations } from "./organizations";

// See docs/specs/pilot-foundations.md §1 — catalog is clinic-owned, no Indian standard exists.
export const procedureCategory = pgEnum("procedure_category", [
  "diagnostic",
  "preventive",
  "restorative",
  "endodontic",
  "periodontic",
  "prosthodontic",
  "oral_surgery",
  "orthodontic",
  "implant",
  "cosmetic",
]);

export const procedureScope = pgEnum("procedure_scope", [
  "mouth",
  "arch",
  "quadrant",
  "tooth",
  "surface",
]);

// exempt_healthcare is the common case in India; gst_5 covers implants/crowns/dentures
// supplied as goods; gst_18 covers cosmetic work. Tax lives on the code, never the invoice.
export const taxClass = pgEnum("tax_class", ["exempt_healthcare", "gst_5", "gst_18"]);

export const procedureCodes = pgTable(
  "procedure_codes",
  {
    ...tenantColumns(),
    // organizationId is nullable here despite tenantColumns() — null = starter template,
    // copied into a clinic's own catalog at onboarding. See pilot-foundations.md §1.
    organizationId: uuid("organization_id").references(() => organizations.id),
    code: text("code").notNull(),
    shortName: text("short_name").notNull(),
    description: text("description"),
    category: procedureCategory("category").notNull(),
    appliesTo: procedureScope("applies_to").notNull(),
    surfacesRequired: boolean("surfaces_required").notNull().default(false),
    taxClass: taxClass("tax_class").notNull().default("exempt_healthcare"),
    cdtEquivalent: text("cdt_equivalent"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("procedure_codes_org_code_idx").on(t.organizationId, t.code),
    // The index above can't stop duplicate codes among organization_id IS NULL rows —
    // Postgres treats every NULL as distinct in a unique index — so the starter template
    // gets its own partial index instead.
    uniqueIndex("procedure_codes_starter_code_idx")
      .on(t.code)
      .where(sql`${t.organizationId} IS NULL`),
  ],
);

export const feeSchedules = pgTable("fee_schedules", {
  ...tenantColumns(),
  name: text("name").notNull(),
  locationId: uuid("location_id").references(() => locations.id),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  isDefault: boolean("is_default").notNull().default(false),
});

export const feeScheduleItems = pgTable(
  "fee_schedule_items",
  {
    ...tenantColumns(),
    feeScheduleId: uuid("fee_schedule_id")
      .notNull()
      .references(() => feeSchedules.id),
    procedureCodeId: uuid("procedure_code_id")
      .notNull()
      .references(() => procedureCodes.id),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex("fee_schedule_items_unique_idx").on(t.feeScheduleId, t.procedureCodeId)],
);
