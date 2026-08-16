import { auditLog } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

/**
 * Written by every mutating service call, not by hand at each call site — a call site
 * that forgets is the failure mode this must not have. See docs/specs/data-model.md.
 * Callers pass the same tenant-scoped `tx` they used for the write, so the audit row
 * lands in the same transaction and can never be written without its subject.
 */
export interface AuditContext {
  organizationId: string;
  actorUserId: string | null;
  actorIp: string | null;
}

export async function writeAudit(
  db: Database,
  ctx: AuditContext,
  entry: {
    entityType: string;
    entityId: string | null;
    action:
      | "create" | "update" | "delete" | "sign" | "void"
      | "login" | "login_failed" | "logout" | "lockout"
      | "invite_accepted" | "password_reset";
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    actorIp: ctx.actorIp,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
