import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { locations, operatories } from "./locations";

// RBAC roles — see docs/specs/pilot-foundations.md §4 for the full permission matrix.
export const userRole = pgEnum("user_role", [
  "owner",
  "admin",
  "front_desk",
  "provider",
  "hygienist",
  "assistant",
  "accountant",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash"), // null until invite accepted
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    role: userRole("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft delete, per the convention in docs/specs/data-model.md — required by login's
    // isNull(users.deletedAt) filter. users.ts predates the tenantColumns() mixin and was
    // hand-written without it; kept explicit here rather than retrofitted to the mixin
    // because organizationId placement differs (declared above, not spread first).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_org_email_idx").on(t.organizationId, t.email)],
);

// Absence of any row for a user = access to all locations. See pilot-foundations.md §4.
export const userLocationAccess = pgTable(
  "user_location_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    registrationNumber: text("registration_number"),
    qualification: text("qualification"),
    defaultOperatoryId: uuid("default_operatory_id").references(() => operatories.id),
    color: text("color").notNull().default("#33556E"),
  },
  (t) => [uniqueIndex("provider_profiles_user_idx").on(t.userId)],
);
