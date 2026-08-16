import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Every domain table gets these columns. organization_id is what RLS filters on —
 * see docs/specs/data-model.md and the enforcement test in db/rls.test.ts.
 */
export function tenantColumns() {
  return {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  };
}
