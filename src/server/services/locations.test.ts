import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, locations, operatories, providerProfiles, providerSchedules } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import {
  listLocations,
  listOperatories,
  listProviders,
  listProviderSchedule,
  LocationNotFoundError,
  ProviderNotFoundError,
} from "./locations";

const TEST_ORG_NAME = "__locations_service_test";

async function createTestOrgAndActor(role: RequestActor["role"] = "front_desk") {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `locations-test-${role}-${Date.now()}@example.test`, fullName: "Test User", role })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role };
  return { org, user, actor };
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations);
  for (const org of orgs) {
    if (org.name !== TEST_ORG_NAME) continue;
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

describe("listLocations", () => {
  afterEach(cleanup);

  it("lists active locations for the actor's org, every role can read", async () => {
    const { org, actor } = await createTestOrgAndActor("front_desk");
    await adminDb.insert(locations).values([
      { organizationId: org.id, name: "Sunrise Main" },
      { organizationId: org.id, name: "Closed Branch", isActive: false },
    ]);

    const result = await listLocations(actor);

    expect(result.map((l) => l.name)).toEqual(["Sunrise Main"]);
  });

  // The pilot schedule shows the org's first location only (schedule/page.tsx). "First" must
  // mean the main clinic, not alphabetical, or a branch named "Baner" outranks the main
  // "Koregaon Park" site and the schedule opens on the wrong clinic.
  it("orders locations by display order, not alphabetically", async () => {
    const { org, actor } = await createTestOrgAndActor("front_desk");
    await adminDb.insert(locations).values([
      { organizationId: org.id, name: "Koregaon Park", displayOrder: 0 },
      { organizationId: org.id, name: "Baner", displayOrder: 1 },
    ]);

    const result = await listLocations(actor);

    expect(result.map((l) => l.name)).toEqual(["Koregaon Park", "Baner"]);
  });

  it("never returns another org's locations", async () => {
    const { actor } = await createTestOrgAndActor("front_desk");
    const [otherOrg] = await adminDb.insert(organizations).values({ name: "__locations_other_org" }).returning();
    await adminDb.insert(locations).values({ organizationId: otherOrg.id, name: "Other Clinic" });

    const result = await listLocations(actor);

    expect(result).toEqual([]);
    await wipeOrganizationData(adminDb, otherOrg.id);
    await adminDb.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});

describe("listOperatories", () => {
  afterEach(cleanup);

  it("lists active operatories for a location, ordered by display order", async () => {
    const { org, actor } = await createTestOrgAndActor("provider");
    const [loc] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    await adminDb.insert(operatories).values([
      { organizationId: org.id, locationId: loc.id, name: "Op 2", displayOrder: 2 },
      { organizationId: org.id, locationId: loc.id, name: "Op 1", displayOrder: 1 },
      { organizationId: org.id, locationId: loc.id, name: "Op 3 (inactive)", displayOrder: 3, isActive: false },
    ]);

    const result = await listOperatories(actor, loc.id);

    expect(result.map((o) => o.name)).toEqual(["Op 1", "Op 2"]);
  });

  it("404s for a location in another org", async () => {
    const { actor } = await createTestOrgAndActor("provider");
    const [otherOrg] = await adminDb.insert(organizations).values({ name: "__locations_other_org2" }).returning();
    const [otherLoc] = await adminDb.insert(locations).values({ organizationId: otherOrg.id, name: "Other" }).returning();

    await expect(listOperatories(actor, otherLoc.id)).rejects.toThrow(LocationNotFoundError);

    await wipeOrganizationData(adminDb, otherOrg.id);
    await adminDb.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});

describe("listProviders", () => {
  afterEach(cleanup);

  it("lists any active user with a provider_profiles row, regardless of RBAC role", async () => {
    const { org, actor } = await createTestOrgAndActor("front_desk");
    // A solo-dentist owner is still bookable — this is exactly the demo org's real shape
    // (Dr Ananya Rao is role='owner' with a provider_profiles row).
    const [dentist] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "dr-rao@example.test", fullName: "Dr Rao", role: "owner" })
      .returning();
    await adminDb.insert(providerProfiles).values({ organizationId: org.id, userId: dentist.id, color: "#123456" });
    await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "front-desk-2@example.test", fullName: "Reception", role: "front_desk" });

    const result = await listProviders(actor);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fullName: "Dr Rao", role: "owner", color: "#123456" });
  });

  it("excludes a user with a clinical role but no provider_profiles row", async () => {
    const { org, actor } = await createTestOrgAndActor("front_desk");
    await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "dr-mehta@example.test", fullName: "Dr Mehta", role: "hygienist" });

    const result = await listProviders(actor);

    expect(result).toEqual([]);
  });
});

describe("listProviderSchedule", () => {
  afterEach(cleanup);

  it("lists a provider's schedule rows, ordered by day of week", async () => {
    const { org, actor } = await createTestOrgAndActor("front_desk");
    const [loc] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    const [dentist] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "dr-rao@example.test", fullName: "Dr Rao", role: "owner" })
      .returning();
    await adminDb.insert(providerSchedules).values([
      { organizationId: org.id, providerId: dentist.id, locationId: loc.id, dayOfWeek: 3, startTime: "09:00", endTime: "17:00", effectiveFrom: "2020-01-01" },
      { organizationId: org.id, providerId: dentist.id, locationId: loc.id, dayOfWeek: 1, startTime: "10:00", endTime: "18:00", effectiveFrom: "2020-01-01" },
    ]);

    const result = await listProviderSchedule(actor, dentist.id, loc.id);

    expect(result.map((r) => r.dayOfWeek)).toEqual([1, 3]);
  });

  it("narrows to one location when location_id is given", async () => {
    const { org, actor } = await createTestOrgAndActor("front_desk");
    const [locA] = await adminDb.insert(locations).values({ organizationId: org.id, name: "A" }).returning();
    const [locB] = await adminDb.insert(locations).values({ organizationId: org.id, name: "B" }).returning();
    const [dentist] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "dr-rao2@example.test", fullName: "Dr Rao", role: "owner" })
      .returning();
    await adminDb.insert(providerSchedules).values([
      { organizationId: org.id, providerId: dentist.id, locationId: locA.id, dayOfWeek: 1, startTime: "09:00", endTime: "17:00", effectiveFrom: "2020-01-01" },
      { organizationId: org.id, providerId: dentist.id, locationId: locB.id, dayOfWeek: 2, startTime: "09:00", endTime: "17:00", effectiveFrom: "2020-01-01" },
    ]);

    const result = await listProviderSchedule(actor, dentist.id, locA.id);

    expect(result.map((r) => r.dayOfWeek)).toEqual([1]);
  });

  it("404s for a provider in another org", async () => {
    const { actor } = await createTestOrgAndActor("front_desk");
    const [otherOrg] = await adminDb.insert(organizations).values({ name: "__locations_other_org3" }).returning();
    const [otherProvider] = await adminDb
      .insert(users)
      .values({ organizationId: otherOrg.id, email: "other-dentist@example.test", fullName: "Other Dentist", role: "owner" })
      .returning();

    await expect(listProviderSchedule(actor, otherProvider.id)).rejects.toThrow(ProviderNotFoundError);

    await wipeOrganizationData(adminDb, otherOrg.id);
    await adminDb.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});
