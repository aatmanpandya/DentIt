import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { adminDb } from "./client";
import { wipeOrganizationData } from "./wipe-organization";
import { organizations, locations, operatories, users, patients } from "./schema";

/**
 * Database-level invariants that the plan and specs describe as guarantees, not just
 * conventions — see docs/specs/data-model.md: "an exclusion constraint ... the database
 * refuses double-booking, not just the service layer." These are exactly the kind of
 * constraint a future migration or a careless schema edit could silently drop without
 * any application-level test noticing, since the app code never explicitly checks for
 * overlaps itself — it relies entirely on Postgres to reject them.
 */
describe("appointments schema invariants", () => {
  let orgId: string;
  let locationId: string;
  let operatoryId: string;
  let patientId: string;
  let providerId: string;

  beforeAll(async () => {
    // Defensive sweep: organizations.name has no uniqueness constraint, and afterAll
    // only knows how to clean up the org THIS run creates. An org orphaned by an
    // earlier run that failed before its own afterAll (exactly what happened once
    // during development — see wipeOrganizationData's history) would otherwise be
    // invisible to every later run and sit in the database indefinitely.
    const stale = await adminDb.select().from(organizations).where(eq(organizations.name, "__schema_test_org"));
    for (const s of stale) {
      await wipeOrganizationData(adminDb, s.id);
      await adminDb.delete(organizations).where(eq(organizations.id, s.id));
    }

    const [org] = await adminDb.insert(organizations).values({ name: "__schema_test_org" }).returning();
    orgId = org.id;
    const [loc] = await adminDb.insert(locations).values({ organizationId: orgId, name: "Main" }).returning();
    locationId = loc.id;
    const [op] = await adminDb.insert(operatories).values({ organizationId: orgId, locationId, name: "Op 1" }).returning();
    operatoryId = op.id;
    const [patient] = await adminDb
      .insert(patients)
      .values({ organizationId: orgId, patientNumber: "T-001", firstName: "Test", lastName: "Patient", phone: "+910000000000" })
      .returning();
    patientId = patient.id;
    const [provider] = await adminDb
      .insert(users)
      .values({ organizationId: orgId, email: "schema-test-provider@example.test", fullName: "Test Provider", role: "provider" })
      .returning();
    providerId = provider.id;
  });

  afterAll(async () => {
    await wipeOrganizationData(adminDb, orgId);
    await adminDb.delete(organizations).where(eq(organizations.id, orgId));
  });

  afterEach(async () => {
    await adminDb.execute(sql`delete from appointments where organization_id = ${orgId}`);
  });

  function insertAppointment(startsAtExpr: string, endsAtExpr: string, status: string) {
    return adminDb.execute(sql`
      insert into appointments (organization_id, location_id, operatory_id, patient_id, provider_id, starts_at, ends_at, status)
      values (${orgId}, ${locationId}, ${operatoryId}, ${patientId}, ${providerId},
              now() + interval '${sql.raw(startsAtExpr)}', now() + interval '${sql.raw(endsAtExpr)}', ${status})
    `);
  }

  it("rejects an end time at or before the start time", async () => {
    await expect(insertAppointment("1 hour", "1 hour", "scheduled")).rejects.toThrow();
  });

  it("rejects two overlapping appointments in the same operatory", async () => {
    await insertAppointment("2 hours", "2 hours 30 minutes", "scheduled");
    await expect(insertAppointment("2 hours 15 minutes", "2 hours 45 minutes", "scheduled")).rejects.toThrow(
      /exclusion constraint/i,
    );
  });

  it("allows a new booking to overlap a CANCELLED appointment in the same slot", async () => {
    await insertAppointment("3 hours", "3 hours 30 minutes", "cancelled");

    // A cancelled slot must not block re-booking the same time — that's the whole
    // point of the partial exclusion WHERE clause (status not in cancelled/no_show).
    await expect(insertAppointment("3 hours", "3 hours 30 minutes", "scheduled")).resolves.toBeDefined();
  });
});

describe("patients schema invariants", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(inArray(organizations.name, ["__patients_schema_test"]));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("rejects a duplicate patient_number within the same organization", async () => {
    const [org] = await adminDb.insert(organizations).values({ name: "__patients_schema_test" }).returning();

    await adminDb.insert(patients).values({
      organizationId: org.id, patientNumber: "P-DUP", firstName: "A", lastName: "One", phone: "+910000000001",
    });

    await expect(
      adminDb.insert(patients).values({
        organizationId: org.id, patientNumber: "P-DUP", firstName: "B", lastName: "Two", phone: "+910000000002",
      }),
    ).rejects.toThrow(/unique/i);
  });
});
