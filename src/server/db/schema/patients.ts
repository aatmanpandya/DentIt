import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { patients, patientSex } from "./_patients-base";

// Re-exported here (not just from _patients-base) because schema/index.ts only walks
// this file — drizzle-kit needs the enum object itself in the exported graph to emit
// its CREATE TYPE statement, not just a table that references it internally.
export { patients, patientSex };

export const responsibleParties = pgTable("responsible_parties", {
  ...tenantColumns(),
  patientId: uuid("patient_id").references(() => patients.id), // set when payer is also a patient
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  relationship: text("relationship").notNull(),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
});

export const alertType = pgEnum("alert_type", ["allergy", "medical", "precaution"]);
export const alertSeverity = pgEnum("alert_severity", ["info", "warning", "critical"]);

export const patientAlerts = pgTable("patient_alerts", {
  ...tenantColumns(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  alertType: alertType("alert_type").notNull(),
  label: text("label").notNull(),
  detail: text("detail"),
  severity: alertSeverity("severity").notNull().default("warning"),
});

export const patientDocuments = pgTable("patient_documents", {
  ...tenantColumns(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: text("size_bytes").notNull(), // bigint as text to dodge JS number limits
  storageKey: text("storage_key").notNull(),
  description: text("description"),
});
