import { bigserial, inet, jsonb, pgEnum, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const auditAction = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "sign",
  "void",
  "login",
  "login_failed",
  "logout",
  "lockout",
  "invite_accepted",
  "password_reset",
]);

// Append-only — the application DB role has no UPDATE/DELETE grant on this table.
// See docs/specs/pilot-foundations.md §4 (compliance floor).
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    actorUserId: uuid("actor_user_id"),
    actorIp: inet("actor_ip"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: auditAction("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    index("audit_log_org_occurred_idx").on(t.organizationId, t.occurredAt),
  ],
);
