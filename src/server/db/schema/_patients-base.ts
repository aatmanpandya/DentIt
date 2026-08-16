import { date, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  },
  (t) => [uniqueIndex("patients_org_number_idx").on(t.organizationId, t.patientNumber)],
);
