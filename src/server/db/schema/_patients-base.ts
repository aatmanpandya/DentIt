import { boolean, date, index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { locations } from "./locations";

export const patientSex = pgEnum("patient_sex", ["male", "female", "other"]);

/**
 * Split out of patients.ts to break an import cycle: responsible_parties references
 * patients, and patients references responsible_parties. Both files import this one.
 */
export const patients = pgTable(
  "patients",
  {
    ...tenantColumns(),
    patientNumber: text("patient_number").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // Nullable deliberately — patients often don't know or won't give DOB. See pilot-foundations.md.
    dateOfBirth: date("date_of_birth"),
    sex: patientSex("sex"),
    phone: text("phone").notNull(),
    email: text("email"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    preferredLocationId: uuid("preferred_location_id").references(() => locations.id),
    responsiblePartyId: uuid("responsible_party_id"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("patients_org_number_idx").on(t.organizationId, t.patientNumber),
    index("patients_phone_idx").on(t.phone),
    // The GIN trigram index on name (first_name || ' ' || last_name) lives in rls.sql,
    // not here — it needs the pg_trgm extension to exist first, and extension creation
    // runs after Drizzle's own migrations (see migrate.ts). Keeping the expression index
    // next to that extension statement keeps the ordering dependency visible in one place.
  ],
);
