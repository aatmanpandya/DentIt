import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./_helpers";
import { locations, operatories } from "./locations";
import { patients } from "./_patients-base";

export const appointmentTypes = pgTable("appointment_types", {
  ...tenantColumns(),
  name: text("name").notNull(),
  defaultDurationMinutes: integer("default_duration_minutes").notNull(),
  color: text("color").notNull().default("#33556E"),
  isActive: boolean("is_active").notNull().default(true),
});

// See docs/specs/pilot-foundations.md §3 for the full transition table.
// Enforced in appointmentService.transition() — this enum only names the states.
export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "arrived",
  "seated",
  "completed",
  "cancelled",
  "no_show",
]);

export const cancelledBy = pgEnum("cancelled_by", ["patient", "practice"]);

export const appointments = pgTable(
  "appointments",
  {
    ...tenantColumns(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    operatoryId: uuid("operatory_id")
      .notNull()
      .references(() => operatories.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    providerId: uuid("provider_id").notNull(), // -> users.id
    appointmentTypeId: uuid("appointment_type_id").references(() => appointmentTypes.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("scheduled"),
    note: text("note"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    seatedAt: timestamp("seated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: cancelledBy("cancelled_by"),
    cancellationReason: text("cancellation_reason"),
    rescheduledToId: uuid("rescheduled_to_id"),
  },
  (t) => [
    check("appointments_time_check", sql`${t.endsAt} > ${t.startsAt}`),
    index("appointments_location_starts_idx").on(t.locationId, t.startsAt),
    index("appointments_patient_idx").on(t.patientId),
    // The real double-booking guard — a Postgres EXCLUDE constraint — is added in the
    // hand-written migration 0002_appointment_exclusion.sql; Drizzle can't express it directly.
  ],
);
