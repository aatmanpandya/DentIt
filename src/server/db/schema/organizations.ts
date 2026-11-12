import { sql } from "drizzle-orm";
import { boolean, pgEnum, pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";

export const toothNotationDisplay = pgEnum("tooth_notation_display", ["fdi", "universal"]);
export const deploymentTarget = pgEnum("deployment_target", ["cloud", "onsite"]);

// No organization_id on this table — it IS the tenant. See docs/adr/0001 and pilot-foundations.md §6.
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  gstRegistered: boolean("gst_registered").notNull().default(false),
  gstin: text("gstin"),
  // Printed on invoices and the patient-facing plan page. A path under /public or a full URL.
  logoUrl: text("logo_url"),
  // Clinic contact email, printed on invoices.
  email: text("email"),
  // Fee-schedule prices already include GST (the clinic quotes the patient one figure).
  // false = prices are before tax and GST is added on the invoice. See docs/specs/ledger.md.
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  toothNotationDisplay: toothNotationDisplay("tooth_notation_display").notNull().default("fdi"),
  probingSequence: jsonb("probing_sequence"),
  deploymentTarget: deploymentTarget("deployment_target").notNull().default("cloud"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  currency: text("currency").notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
