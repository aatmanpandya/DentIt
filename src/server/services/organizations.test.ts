import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import { PermissionDeniedError } from "@/server/lib/permissions";
import type { RequestActor } from "@/server/lib/request-auth";
import { updateProbingSequence, InvalidProbingSequenceError } from "./organizations";

const TEST_ORG_NAME = "__organizations_service_test";

const FULL_PERMANENT_SET = [
  "18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28",
  "48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38",
];

async function setup(role: RequestActor["role"] = "owner") {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `org-${Date.now()}-${Math.random()}@example.test`, fullName: "Test User", role })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role };
  return { org, actor };
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

describe("updateProbingSequence", () => {
  afterEach(cleanup);

  it("sets a valid 32-tooth sequence as owner", async () => {
    const { actor } = await setup("owner");
    const after = await updateProbingSequence(actor, { probing_sequence: FULL_PERMANENT_SET });
    expect(after.probingSequence).toEqual(FULL_PERMANENT_SET);
  });

  it("clears the sequence back to the hardcoded default with null", async () => {
    const { actor } = await setup("owner");
    await updateProbingSequence(actor, { probing_sequence: FULL_PERMANENT_SET });
    const after = await updateProbingSequence(actor, { probing_sequence: null });
    expect(after.probingSequence).toBeNull();
  });

  it("rejects a sequence with a duplicate", async () => {
    const { actor } = await setup("owner");
    const bad = [...FULL_PERMANENT_SET.slice(1), FULL_PERMANENT_SET[1]];
    await expect(updateProbingSequence(actor, { probing_sequence: bad })).rejects.toThrow(InvalidProbingSequenceError);
  });

  it("rejects a sequence containing a primary tooth code", async () => {
    const { actor } = await setup("owner");
    const bad = [...FULL_PERMANENT_SET.slice(1), "51"];
    await expect(updateProbingSequence(actor, { probing_sequence: bad })).rejects.toThrow(InvalidProbingSequenceError);
  });

  it("rejects the wrong length", async () => {
    const { actor } = await setup("owner");
    await expect(updateProbingSequence(actor, { probing_sequence: FULL_PERMANENT_SET.slice(0, 31) })).rejects.toThrow(
      InvalidProbingSequenceError,
    );
  });

  it("is owner-only", async () => {
    const { actor } = await setup("admin");
    await expect(updateProbingSequence(actor, { probing_sequence: FULL_PERMANENT_SET })).rejects.toThrow(PermissionDeniedError);
  });
});
