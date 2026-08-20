import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, patients, chartedConditions } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import { PermissionDeniedError } from "@/server/lib/permissions";
import type { RequestActor } from "@/server/lib/request-auth";
import { PatientNotFoundError } from "./patients";
import {
  createPerioExam,
  getPerioExam,
  listPatientPerioExams,
  listEligiblePerioProviders,
  updatePerioExamNotes,
  upsertPerioToothRecord,
  completePerioExam,
  uncompletePerioExam,
  comparePerioExam,
  PerioExamNotFoundError,
  PerioExamCompletedError,
  InvalidFurcationError,
  InvalidToothError,
  InvalidProviderError,
} from "./perio";

const TEST_ORG_NAME = "__perio_service_test";

async function setup(role: RequestActor["role"] = "hygienist") {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `perio-${Date.now()}-${Math.random()}@example.test`, fullName: "Test Staff", role })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role };

  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();

  return { org, actor, patient, user };
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

describe("createPerioExam", () => {
  afterEach(cleanup);

  it("seeds a tooth record for every present socket, auto-skipping primary teeth by default", async () => {
    const { actor, patient } = await setup();

    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    const { teeth } = await getPerioExam(actor, exam.id);

    // 20 primary-eligible sockets (positions 1-5 x 4 quadrants) default to the primary
    // tooth (nothing charted as exfoliated/missing) and auto-skip; 12 molar-only sockets
    // (positions 6-8 x 4 quadrants) have no primary equivalent and default to un-skipped.
    expect(teeth).toHaveLength(32);
    const skipped = teeth.filter((t) => t.record.isSkipped);
    const notSkipped = teeth.filter((t) => !t.record.isSkipped);
    expect(skipped).toHaveLength(20);
    expect(notSkipped).toHaveLength(12);
    expect(skipped.every((t) => ["5", "6", "7", "8"].includes(t.record.tooth[0]))).toBe(true);
    expect(notSkipped.map((t) => t.record.tooth).sort()).toEqual(
      ["16", "17", "18", "26", "27", "28", "36", "37", "38", "46", "47", "48"].sort(),
    );
  });

  it("auto-skips a permanent tooth charted as missing", async () => {
    const { actor, patient } = await setup();
    await adminDb.insert(chartedConditions).values({
      organizationId: actor.organizationId,
      patientId: patient.id,
      tooth: "16",
      conditionType: "missing",
      chartedBy: actor.userId,
      createdBy: actor.userId,
    });

    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    const { teeth } = await getPerioExam(actor, exam.id);

    const tooth16 = teeth.find((t) => t.record.tooth === "16");
    expect(tooth16?.record.isSkipped).toBe(true);
  });

  it("defaults provider_id to the actor when not picked", async () => {
    const { actor, patient } = await setup("provider");
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    expect(exam.providerId).toBe(actor.userId);
  });

  it("respects an explicitly picked provider_id (e.g. an assistant transcribing for a hygienist)", async () => {
    const { actor, patient, org } = await setup("assistant");
    const [hygienist] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: `hyg-${Date.now()}@example.test`, fullName: "Hygienist", role: "hygienist" })
      .returning();

    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19", provider_id: hygienist.id });
    expect(exam.providerId).toBe(hygienist.id);
  });

  it("rejects a non-existent patient", async () => {
    const { actor } = await setup();
    await expect(createPerioExam(actor, "00000000-0000-0000-0000-000000000000", { exam_date: "2026-08-19" })).rejects.toThrow(
      PatientNotFoundError,
    );
  });

  it("assistants can write perio (unlike clinical notes) — permissions.ts's perio matrix", async () => {
    const { actor, patient } = await setup("assistant");
    await expect(createPerioExam(actor, patient.id, { exam_date: "2026-08-19" })).resolves.toBeTruthy();
  });

  it("admin is read-only on perio", async () => {
    const { actor, patient } = await setup("admin");
    await expect(createPerioExam(actor, patient.id, { exam_date: "2026-08-19" })).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects a provider_id that isn't an eligible clinical-staff role in this org", async () => {
    const { actor, patient, org } = await setup("assistant");
    const [frontDesk] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: `fd-${Date.now()}@example.test`, fullName: "Front Desk", role: "front_desk" })
      .returning();

    await expect(
      createPerioExam(actor, patient.id, { exam_date: "2026-08-19", provider_id: frontDesk.id }),
    ).rejects.toThrow(InvalidProviderError);
  });

  it("rejects a provider_id from a different organization", async () => {
    const { actor, patient } = await setup("assistant");
    const [otherOrg] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
    const [otherOrgProvider] = await adminDb
      .insert(users)
      .values({ organizationId: otherOrg.id, email: `other-${Date.now()}@example.test`, fullName: "Other Org Provider", role: "provider" })
      .returning();

    await expect(
      createPerioExam(actor, patient.id, { exam_date: "2026-08-19", provider_id: otherOrgProvider.id }),
    ).rejects.toThrow(InvalidProviderError);
  });
});

describe("listEligiblePerioProviders", () => {
  afterEach(cleanup);

  it("lists active clinical staff eligible to be picked as a perio provider, sorted by name", async () => {
    const { actor, org } = await setup("owner");
    await adminDb.insert(users).values([
      { organizationId: org.id, email: `prov-${Date.now()}@example.test`, fullName: "Zed Provider", role: "provider" },
      { organizationId: org.id, email: `hyg-${Date.now()}@example.test`, fullName: "Amy Hygienist", role: "hygienist" },
      { organizationId: org.id, email: `asst-${Date.now()}@example.test`, fullName: "Bo Assistant", role: "assistant" },
      { organizationId: org.id, email: `fd-${Date.now()}@example.test`, fullName: "Front Desk Person", role: "front_desk" },
      { organizationId: org.id, email: `acct-${Date.now()}@example.test`, fullName: "Accountant Person", role: "accountant" },
    ]);

    const eligible = await listEligiblePerioProviders(actor);

    // setup("owner") itself creates an eligible user ("Test Staff", role owner) — included.
    expect(eligible.map((p) => p.fullName)).toEqual(["Amy Hygienist", "Bo Assistant", "Test Staff", "Zed Provider"]);
  });

  it("excludes inactive users", async () => {
    const { actor, org } = await setup("owner");
    const [inactiveProvider] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: `inactive-${Date.now()}@example.test`, fullName: "Inactive Provider", role: "provider", isActive: false })
      .returning();

    const eligible = await listEligiblePerioProviders(actor);

    expect(eligible.map((p) => p.id)).not.toContain(inactiveProvider.id);
  });

  it("excludes front_desk and accountant roles", async () => {
    const { actor, org } = await setup("owner");
    const [frontDesk] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: `fd2-${Date.now()}@example.test`, fullName: "Front Desk Two", role: "front_desk" })
      .returning();

    const eligible = await listEligiblePerioProviders(actor);

    expect(eligible.map((p) => p.id)).not.toContain(frontDesk.id);
  });
});

describe("upsertPerioToothRecord", () => {
  afterEach(cleanup);

  it("saves mobility, furcation, and all six sites for a furcation-eligible tooth in one call", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const { record, sites } = await upsertPerioToothRecord(actor, exam.id, "16", {
      mobility: 1,
      furcation: 2,
      sites: [
        { site: "MB", pocket_depth: 3, gingival_margin: 0, bleeding_on_probing: true },
        { site: "B", pocket_depth: 2 },
        { site: "DB", pocket_depth: 4, gingival_margin: 1, suppuration: true },
        { site: "ML", pocket_depth: 3 },
        { site: "L", pocket_depth: 2, plaque: true },
        { site: "DL", pocket_depth: 5, gingival_margin: -1 },
      ],
    });

    expect(record.mobility).toBe(1);
    expect(record.furcation).toBe(2);
    expect(sites).toHaveLength(6);
    const mb = sites.find((s) => s.site === "MB");
    expect(mb?.pocketDepth).toBe(3);
    expect(mb?.bleedingOnProbing).toBe(true);
  });

  it("rejects furcation on a tooth that isn't multi-rooted", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    await expect(
      upsertPerioToothRecord(actor, exam.id, "51", { furcation: 1, sites: [] }),
    ).rejects.toThrow(InvalidFurcationError);
  });

  it("rejects a tooth not seeded into this exam", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    // "11" isn't seeded — the default-state socket resolves to primary "51" instead.
    await expect(upsertPerioToothRecord(actor, exam.id, "11", { sites: [] })).rejects.toThrow(InvalidToothError);
  });

  it("rejects edits once the exam is completed", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    await completePerioExam(actor, exam.id);

    await expect(upsertPerioToothRecord(actor, exam.id, "16", { sites: [] })).rejects.toThrow(PerioExamCompletedError);
  });

  it("re-saving with only is_skipped doesn't clobber previously saved mobility/furcation", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    await upsertPerioToothRecord(actor, exam.id, "16", { mobility: 2, furcation: 1, sites: [] });
    const { record } = await upsertPerioToothRecord(actor, exam.id, "16", { is_skipped: true, sites: [] });

    expect(record.isSkipped).toBe(true);
    expect(record.mobility).toBe(2);
    expect(record.furcation).toBe(1);
  });

  it("un-skips an auto-skipped primary tooth (symmetric skip toggle)", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const { record: before } = await upsertPerioToothRecord(actor, exam.id, "51", { sites: [] });
    expect(before.isSkipped).toBe(true); // auto-skipped primary, untouched

    const { record: after } = await upsertPerioToothRecord(actor, exam.id, "51", { is_skipped: false, sites: [] });
    expect(after.isSkipped).toBe(false);
  });

  it("manually skips an otherwise-normal tooth mid-exam (patient can't tolerate probing)", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const { record } = await upsertPerioToothRecord(actor, exam.id, "16", { is_skipped: true, sites: [] });
    expect(record.isSkipped).toBe(true);
  });
});

describe("exam notes and lifecycle", () => {
  afterEach(cleanup);

  it("updates the exam's inline notes field", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const after = await updatePerioExamNotes(actor, exam.id, { notes: "Patient couldn't tolerate posterior probing today." });
    expect(after.notes).toBe("Patient couldn't tolerate posterior probing today.");
  });

  it("completes then un-completes an exam", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const completed = await completePerioExam(actor, exam.id);
    expect(completed.completedAt).not.toBeNull();

    await expect(completePerioExam(actor, exam.id)).rejects.toThrow(PerioExamCompletedError);

    const reopened = await uncompletePerioExam(actor, exam.id);
    expect(reopened.completedAt).toBeNull();

    // Editable again after un-complete.
    await expect(upsertPerioToothRecord(actor, exam.id, "16", { sites: [] })).resolves.toBeTruthy();
  });

  it("lists exams for a patient, most recent exam_date first", async () => {
    const { actor, patient } = await setup();
    await createPerioExam(actor, patient.id, { exam_date: "2026-02-19" });
    await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const exams = await listPatientPerioExams(actor, patient.id);
    expect(exams).toHaveLength(2);
    expect(exams[0].examDate).toBe("2026-08-19");
  });

  it("404s on a cross-tenant / nonexistent exam id", async () => {
    const { actor } = await setup();
    await expect(getPerioExam(actor, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(PerioExamNotFoundError);
  });
});

describe("comparePerioExam", () => {
  afterEach(cleanup);

  it("computes per-site CAL delta against the most recent prior exam by default", async () => {
    const { actor, patient } = await setup();

    const older = await createPerioExam(actor, patient.id, { exam_date: "2026-02-19" });
    await upsertPerioToothRecord(actor, older.id, "16", { sites: [{ site: "MB", pocket_depth: 3, gingival_margin: 0 }] });

    const newer = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    await upsertPerioToothRecord(actor, newer.id, "16", { sites: [{ site: "MB", pocket_depth: 5, gingival_margin: 1 }] });

    const result = await comparePerioExam(actor, newer.id);
    expect(result.against_exam_id).toBe(older.id);

    const mb = result.deltas.find((d) => d.tooth === "16" && d.site === "MB");
    expect(mb?.cal_now).toBe(6); // 5 + 1
    expect(mb?.cal_before).toBe(3); // 3 + 0
    expect(mb?.delta).toBe(3);
    expect(mb?.significant).toBe(true); // >= 2mm
  });

  it("has no prior comparison for a patient's first exam", async () => {
    const { actor, patient } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    await upsertPerioToothRecord(actor, exam.id, "16", { sites: [{ site: "MB", pocket_depth: 3, gingival_margin: 0 }] });

    const result = await comparePerioExam(actor, exam.id);
    expect(result.against_exam_id).toBeNull();
    expect(result.deltas[0].cal_before).toBeNull();
    expect(result.deltas[0].significant).toBe(false);
  });

  it("accepts an explicit against exam id belonging to the same patient", async () => {
    const { actor, patient } = await setup();
    const older = await createPerioExam(actor, patient.id, { exam_date: "2026-01-01" });
    await upsertPerioToothRecord(actor, older.id, "16", { sites: [{ site: "MB", pocket_depth: 2, gingival_margin: 0 }] });
    const middle = await createPerioExam(actor, patient.id, { exam_date: "2026-04-01" });
    await upsertPerioToothRecord(actor, middle.id, "16", { sites: [{ site: "MB", pocket_depth: 4, gingival_margin: 0 }] });
    const newest = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });
    await upsertPerioToothRecord(actor, newest.id, "16", { sites: [{ site: "MB", pocket_depth: 5, gingival_margin: 0 }] });

    // Explicitly compare against the OLDER exam, not the default (most-recent-prior = middle).
    const result = await comparePerioExam(actor, newest.id, older.id);
    expect(result.against_exam_id).toBe(older.id);
    expect(result.deltas.find((d) => d.tooth === "16" && d.site === "MB")?.cal_before).toBe(2);
  });

  it("rejects comparing against an exam that belongs to a different patient (cross-patient leak)", async () => {
    const { actor, patient, org } = await setup();
    const exam = await createPerioExam(actor, patient.id, { exam_date: "2026-08-19" });

    const [otherPatient] = await adminDb
      .insert(patients)
      .values({ organizationId: org.id, patientNumber: "P-0002", firstName: "Other", lastName: "Patient", phone: "9000000001" })
      .returning();
    const otherExam = await createPerioExam(actor, otherPatient.id, { exam_date: "2026-08-01" });
    await upsertPerioToothRecord(actor, otherExam.id, "16", { sites: [{ site: "MB", pocket_depth: 9, gingival_margin: 0 }] });

    await expect(comparePerioExam(actor, exam.id, otherExam.id)).rejects.toThrow(PerioExamNotFoundError);
  });
});
