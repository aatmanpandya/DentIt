import { describe, it, expect, afterEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { adminDb } from "./client";
import { wipeOrganizationData } from "./wipe-organization";
import { organizations, locations, operatories } from "./schema";

/**
 * Regression coverage for a real bug: the original implementation ran a Postgres
 * `DO $$ ... $$` block with an external bind parameter interpolated into it
 * (`${existing.id}`). Anonymous DO blocks cannot receive bind parameters at all —
 * Postgres has nowhere to infer the type of $1 from, since it's never referenced by
 * the block's own body (only by the driver's parameter list). This was invisible
 * during development because the seed script only hit this path on a *second* run —
 * the first run always finds no prior organization and skips it entirely.
 *
 * Reproduced live: `npm run seed` twice in a row failed with
 * `PostgresError: could not determine data type of parameter $1`.
 */
describe("wipeOrganizationData", () => {
  async function createOrgWithOneLocation(name: string) {
    const [org] = await adminDb.insert(organizations).values({ name }).returning();
    const [loc] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    return { org, loc };
  }

  afterEach(async () => {
    // Wipe dependents before deleting the org row itself — org B in particular is
    // deliberately left un-wiped by the tests, so its location must be cleaned here.
    const orgs = await adminDb
      .select()
      .from(organizations)
      .where(inArray(organizations.name, ["__wipe_test_a", "__wipe_test_b"]));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("does not throw — the original bug crashed on every call", async () => {
    const { org } = await createOrgWithOneLocation("__wipe_test_a");
    await expect(wipeOrganizationData(adminDb, org.id)).resolves.not.toThrow();
  });

  it("deletes only the target organization's rows, leaving other tenants untouched", async () => {
    const { org: orgA, loc: locA } = await createOrgWithOneLocation("__wipe_test_a");
    const { loc: locB } = await createOrgWithOneLocation("__wipe_test_b");

    await wipeOrganizationData(adminDb, orgA.id);

    const remainingA = await adminDb.select().from(locations).where(eq(locations.id, locA.id));
    const remainingB = await adminDb.select().from(locations).where(eq(locations.id, locB.id));

    expect(remainingA).toEqual([]);
    expect(remainingB).toHaveLength(1);
    expect(remainingB[0]?.id).toBe(locB.id);
  });

  it("handles FK-dependent tables regardless of deletion order", async () => {
    // A second real bug found while testing the first fix: information_schema doesn't
    // return tables in dependency order, so a naive single pass deletes `locations`
    // before `operatories` and fails with a foreign key violation.
    const { org, loc } = await createOrgWithOneLocation("__wipe_test_a");
    await adminDb.insert(operatories).values({ organizationId: org.id, locationId: loc.id, name: "Op 1" });

    await expect(wipeOrganizationData(adminDb, org.id)).resolves.not.toThrow();

    const remainingOps = await adminDb.select().from(operatories).where(eq(operatories.organizationId, org.id));
    const remainingLocs = await adminDb.select().from(locations).where(eq(locations.organizationId, org.id));
    expect(remainingOps).toEqual([]);
    expect(remainingLocs).toEqual([]);
  });
});
