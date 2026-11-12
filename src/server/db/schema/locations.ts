import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  // Lowest first. The pilot schedule shows only the first location, so 0 is the main site.
  displayOrder: integer("display_order").notNull().default(0),
});

export const operatories = pgTable("operatories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const providerSchedules = pgTable("provider_schedules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  providerId: uuid("provider_id").notNull(), // -> users.id, added via relations to avoid cycle
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  effectiveFrom: text("effective_from").notNull(), // date, stored as ISO string
  effectiveTo: text("effective_to"),
});

export const scheduleBlocks = pgTable("schedule_blocks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  locationId: uuid("location_id").references(() => locations.id),
  providerId: uuid("provider_id"), // -> users.id
  operatoryId: uuid("operatory_id").references(() => operatories.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
});
