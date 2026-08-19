import { eq } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import { organizations } from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { isValidFdiTooth, isPrimaryTooth } from "@/server/lib/tooth-notation";
import { writeAudit } from "./audit";
import type { RequestActor } from "@/server/lib/request-auth";

// 422 — generic VALIDATION_FAILED. Must be exactly the 32 permanent FDI codes, each once —
// the perio traversal-order utility (docs/specs/perio.md) walks this list and substitutes
// whichever tooth actually occupies each socket, so it can't tolerate a malformed sequence.
export class InvalidProbingSequenceError extends Error {
  constructor() {
    super("The probing sequence must list each of the 32 permanent teeth exactly once.");
    this.name = "InvalidProbingSequenceError";
  }
}

export interface UpdateProbingSequenceInput {
  probing_sequence: string[] | null;
}

/**
 * PATCH /organization — owner-only per the `org_settings` RBAC resource. Only the perio
 * probing-sequence field is exposed here for now (docs/specs/perio.md's traversal-order
 * decision, `organizations.probing_sequence` — already in schema per pilot-foundations.md
 * §2). Not meant to grow into a general org-settings endpoint without a real need for one.
 */
export async function updateProbingSequence(actor: RequestActor, input: UpdateProbingSequenceInput) {
  assertCan(actor.role, "org_settings", "write");

  if (input.probing_sequence !== null) {
    const seq = input.probing_sequence;
    const valid = seq.length === 32 && new Set(seq).size === 32 && seq.every((fdi) => isValidFdiTooth(fdi) && !isPrimaryTooth(fdi));
    if (!valid) throw new InvalidProbingSequenceError();
  }

  return dbForRequest(actor.organizationId, async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, actor.organizationId)).limit(1);

    const [after] = await tx
      .update(organizations)
      .set({ probingSequence: input.probing_sequence, updatedAt: new Date() })
      .where(eq(organizations.id, actor.organizationId))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "organization",
      entityId: actor.organizationId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}
