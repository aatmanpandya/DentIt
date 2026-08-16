import { describe, it, expect, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import {
  organizations,
  users,
  locations,
  operatories,
  auditLog,
  appointments,
  invoices,
  payments,
  paymentAllocations,
} from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import { PermissionDeniedError } from "@/server/lib/permissions";
import {
  createPatient,
  getPatient,
  listPatients,
  updatePatient,
  deletePatient,
  listPatientAlerts,
  createPatientAlert,
  updatePatientAlert,
  getPatientSummary,
  PatientNotFoundError,
} from "./patients";

const TEST_ORG_NAME = "__patients_service_test";

async function createTestOrgAndActor(role: RequestActor["role"] = "front_desk") {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `patients-test-${role}@example.test`, fullName: "Test User", role })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role };
  return { org, user, actor };
}

describe("createPatient", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("creates a patient with only the required fields and assigns a patient number", async () => {
    const { actor } = await createTestOrgAndActor();

    const patient = await createPatient(actor, {
      first_name: "Arjun",
      last_name: "Kulkarni",
      phone: "+919822014477",
    });

    expect(patient.firstName).toBe("Arjun");
    expect(patient.lastName).toBe("Kulkarni");
    expect(patient.phone).toBe("+919822014477");
    expect(patient.patientNumber).toMatch(/^P-\d{4,}$/);
    expect(patient.dateOfBirth).toBeNull();
  });

  it("rejects an accountant — read-only on patients per the RBAC matrix", async () => {
    const { actor } = await createTestOrgAndActor("accountant");

    await expect(
      createPatient(actor, { first_name: "A", last_name: "B", phone: "+910000000000" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("creates and links an inline Responsible Party", async () => {
    const { actor } = await createTestOrgAndActor();

    const patient = await createPatient(actor, {
      first_name: "Ishita",
      last_name: "Banerjee",
      phone: "+919822774411",
      responsible_party: { full_name: "Sudipto Banerjee", phone: "+919822774411", relationship: "Father" },
    });

    expect(patient.responsiblePartyId).toBeTruthy();
  });
});

describe("getPatient", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("fetches a patient by id", async () => {
    const { actor } = await createTestOrgAndActor();
    const created = await createPatient(actor, { first_name: "Rohan", last_name: "Shetty", phone: "+919511339922" });

    const fetched = await getPatient(actor, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.firstName).toBe("Rohan");
  });

  it("throws PatientNotFoundError for an id that doesn't exist", async () => {
    const { actor } = await createTestOrgAndActor();
    await expect(getPatient(actor, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(PatientNotFoundError);
  });

  it("throws PatientNotFoundError for a patient belonging to another organization — never leaks existence", async () => {
    const { actor: actorA } = await createTestOrgAndActor();
    const { actor: actorB } = await createTestOrgAndActor();
    const patientInOrgA = await createPatient(actorA, { first_name: "X", last_name: "Y", phone: "+910000000001" });

    await expect(getPatient(actorB, patientInOrgA.id)).rejects.toThrow(PatientNotFoundError);
  });
});

describe("listPatients", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("paginates by patient_number, default page size honoured via limit", async () => {
    const { actor } = await createTestOrgAndActor();
    for (let i = 0; i < 3; i++) {
      await createPatient(actor, { first_name: `P${i}`, last_name: "Test", phone: `+9100000000${i}` });
    }

    const page1 = await listPatients(actor, { limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await listPatients(actor, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const seenIds = new Set([...page1.data, ...page2.data].map((p) => p.id));
    expect(seenIds.size).toBe(3);
  });

  it("finds a patient by a partial name match — trigram search", async () => {
    const { actor } = await createTestOrgAndActor();
    await createPatient(actor, { first_name: "Meenakshi", last_name: "Iyer", phone: "+919960221188" });
    await createPatient(actor, { first_name: "Rohan", last_name: "Shetty", phone: "+919511339922" });

    const result = await listPatients(actor, { q: "Iyer" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].lastName).toBe("Iyer");
  });

  it("finds a patient by phone or patient number substring", async () => {
    const { actor } = await createTestOrgAndActor();
    const p = await createPatient(actor, { first_name: "Fatima", last_name: "Shaikh", phone: "+919730558811" });

    expect((await listPatients(actor, { q: "9730558811" })).data.map((r) => r.id)).toContain(p.id);
    expect((await listPatients(actor, { q: p.patientNumber })).data.map((r) => r.id)).toContain(p.id);
  });

  it("filters by preferred location", async () => {
    const { actor, org } = await createTestOrgAndActor();
    const [locA] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Location A" }).returning();
    const [locB] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Location B" }).returning();

    const inA = await createPatient(actor, {
      first_name: "In", last_name: "A", phone: "+910000000010", preferred_location_id: locA.id,
    });
    await createPatient(actor, {
      first_name: "In", last_name: "B", phone: "+910000000011", preferred_location_id: locB.id,
    });

    const result = await listPatients(actor, { location_id: locA.id });
    expect(result.data.map((r) => r.id)).toEqual([inA.id]);
  });
});

describe("updatePatient", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("updates only the given fields, leaving the rest untouched", async () => {
    const { actor } = await createTestOrgAndActor();
    const created = await createPatient(actor, { first_name: "Nikhil", last_name: "Rane", phone: "+919049883322" });

    const updated = await updatePatient(actor, created.id, { city: "Pune" });

    expect(updated.city).toBe("Pune");
    expect(updated.firstName).toBe("Nikhil");
    expect(updated.phone).toBe("+919049883322");
  });

  it("writes an audit row with before and after state", async () => {
    const { actor } = await createTestOrgAndActor();
    const created = await createPatient(actor, { first_name: "Tanvi", last_name: "Gokhale", phone: "+917756441100" });

    await updatePatient(actor, created.id, { last_name: "Gokhale-Rao" });

    const [entry] = await adminDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "patient"), eq(auditLog.entityId, created.id), eq(auditLog.action, "update")));

    expect(entry).toBeTruthy();
    expect((entry.before as { lastName: string }).lastName).toBe("Gokhale");
    expect((entry.after as { lastName: string }).lastName).toBe("Gokhale-Rao");
  });

  it("throws PatientNotFoundError for a patient in another organization", async () => {
    const { actor: actorA } = await createTestOrgAndActor();
    const { actor: actorB } = await createTestOrgAndActor();
    const patientInOrgA = await createPatient(actorA, { first_name: "X", last_name: "Y", phone: "+910000000002" });

    await expect(updatePatient(actorB, patientInOrgA.id, { city: "Nowhere" })).rejects.toThrow(PatientNotFoundError);
  });

  it("marks a patient inactive without soft-deleting them — is_active per docs/specs/data-model.md", async () => {
    const { actor } = await createTestOrgAndActor();
    const created = await createPatient(actor, { first_name: "Imran", last_name: "Qureshi", phone: "+918806551122" });
    expect(created.isActive).toBe(true);

    const updated = await updatePatient(actor, created.id, { is_active: false });
    expect(updated.isActive).toBe(false);
    // Still fetchable — is_active is a lighter flag than the deletedAt soft-delete.
    await expect(getPatient(actor, created.id)).resolves.toMatchObject({ isActive: false });
  });
});

describe("deletePatient", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("soft-deletes when the actor is owner or admin", async () => {
    const { actor: owner } = await createTestOrgAndActor("owner");
    const created = await createPatient(owner, { first_name: "A", last_name: "B", phone: "+910000000003" });

    await deletePatient(owner, created.id);

    await expect(getPatient(owner, created.id)).rejects.toThrow(PatientNotFoundError);
  });

  it("rejects a front desk actor — deletion is owner/admin only per docs/specs/api-surface.md", async () => {
    const { actor: frontDesk } = await createTestOrgAndActor("front_desk");
    const created = await createPatient(frontDesk, { first_name: "A", last_name: "B", phone: "+910000000004" });

    await expect(deletePatient(frontDesk, created.id)).rejects.toThrow(PermissionDeniedError);
  });
});

describe("patient alerts", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("creates and lists an alert for a patient", async () => {
    const { actor } = await createTestOrgAndActor();
    const patient = await createPatient(actor, { first_name: "Arjun", last_name: "K", phone: "+910000000005" });

    const alert = await createPatientAlert(actor, patient.id, {
      alert_type: "allergy",
      label: "Penicillin",
      severity: "critical",
      detail: "Rash and swelling, 2019",
    });
    expect(alert.label).toBe("Penicillin");
    expect(alert.severity).toBe("critical");

    const alerts = await listPatientAlerts(actor, patient.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe(alert.id);
  });

  it("defaults severity to warning when not given", async () => {
    const { actor } = await createTestOrgAndActor();
    const patient = await createPatient(actor, { first_name: "Meenakshi", last_name: "I", phone: "+910000000006" });

    const alert = await createPatientAlert(actor, patient.id, { alert_type: "medical", label: "Diabetes" });
    expect(alert.severity).toBe("warning");
  });

  it("deactivates an alert without deleting its history", async () => {
    const { actor } = await createTestOrgAndActor();
    const patient = await createPatient(actor, { first_name: "Sunita", last_name: "D", phone: "+910000000007" });
    const alert = await createPatientAlert(actor, patient.id, { alert_type: "allergy", label: "Latex" });

    const updated = await updatePatientAlert(actor, alert.id, { is_active: false });
    expect(updated.isActive).toBe(false);

    // Still listed — the endpoint shows history, callers filter on isActive as needed.
    const alerts = await listPatientAlerts(actor, patient.id);
    expect(alerts.map((a) => a.id)).toContain(alert.id);
  });

  it("rejects an alert write from a role without patients write access", async () => {
    const { actor: owner, org } = await createTestOrgAndActor("owner");
    const [accountantUser] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "patients-test-accountant2@example.test", fullName: "Accountant", role: "accountant" })
      .returning();
    const accountant: RequestActor = { userId: accountantUser.id, organizationId: org.id, role: "accountant" };
    const patient = await createPatient(owner, { first_name: "X", last_name: "Y", phone: "+910000000008" });

    await expect(
      createPatientAlert(accountant, patient.id, { alert_type: "allergy", label: "Latex" }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("getPatientSummary", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("is empty-but-well-formed for a brand new patient — no appointments or invoices yet", async () => {
    const { actor } = await createTestOrgAndActor();
    const patient = await createPatient(actor, { first_name: "New", last_name: "Patient", phone: "+910000000009" });

    const summary = await getPatientSummary(actor, patient.id);
    expect(summary.alerts).toEqual([]);
    expect(summary.nextAppointment).toBeNull();
    expect(summary.lastVisitAt).toBeNull();
    expect(summary.balance).toBe("0.00");
  });

  it("surfaces active alerts, the next appointment, last visit, and outstanding balance", async () => {
    const { actor, org, user } = await createTestOrgAndActor("owner");
    const patient = await createPatient(actor, { first_name: "Devendra", last_name: "Pawar", phone: "+910000000010" });

    await createPatientAlert(actor, patient.id, { alert_type: "medical", label: "On blood thinners", severity: "critical" });
    const inactiveAlert = await createPatientAlert(actor, patient.id, { alert_type: "precaution", label: "Old note" });
    await updatePatientAlert(actor, inactiveAlert.id, { is_active: false });

    const [loc] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    const [op] = await adminDb.insert(operatories).values({ organizationId: org.id, locationId: loc.id, name: "Op 1" }).returning();

    const [pastAppt] = await adminDb
      .insert(appointments)
      .values({
        organizationId: org.id, locationId: loc.id, operatoryId: op.id, patientId: patient.id, providerId: user.id,
        startsAt: new Date(Date.now() - 7 * 86_400_000), endsAt: new Date(Date.now() - 7 * 86_400_000 + 1_800_000),
        status: "completed",
      })
      .returning();

    const futureStart = new Date(Date.now() + 2 * 86_400_000);
    const [futureAppt] = await adminDb
      .insert(appointments)
      .values({
        organizationId: org.id, locationId: loc.id, operatoryId: op.id, patientId: patient.id, providerId: user.id,
        startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1_800_000),
        status: "confirmed",
      })
      .returning();

    const [invoice] = await adminDb
      .insert(invoices)
      .values({
        organizationId: org.id, locationId: loc.id, patientId: patient.id,
        invoiceNumber: "INV-0001", status: "issued", subtotal: "1000.00", total: "1000.00",
      })
      .returning();
    const [payment] = await adminDb
      .insert(payments)
      .values({ organizationId: org.id, locationId: loc.id, patientId: patient.id, amount: "400.00", method: "cash", receivedBy: user.id })
      .returning();
    await adminDb.insert(paymentAllocations).values({
      organizationId: org.id, paymentId: payment.id, invoiceId: invoice.id, amount: "400.00",
    });

    const summary = await getPatientSummary(actor, patient.id);

    expect(summary.alerts).toHaveLength(1);
    expect(summary.alerts[0].label).toBe("On blood thinners");
    expect(summary.nextAppointment?.id).toBe(futureAppt.id);
    expect(summary.lastVisitAt).toEqual(pastAppt.startsAt);
    expect(summary.balance).toBe("600.00");
  });
});
