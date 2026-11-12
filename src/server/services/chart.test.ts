import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, patients, procedureCodes, providerProfiles, chartedProcedures } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import { dbForRequest } from "@/server/db/tenant";
import type { RequestActor } from "@/server/lib/request-auth";
import { PatientNotFoundError } from "./patients";
import {
  createCondition,
  updateCondition,
  createProcedure,
  updateProcedureStatus,
  updateProcedureContent,
  deleteProcedure,
  getPatientChart,
  getToothState,
  ProcedureNotFoundError,
  ProcedureScopeMismatchError,
  ProcedureInvalidSurfaceError,
  IllegalProcedureTransitionError,
  ProcedureAlreadyInvoicedError,
  ProcedureNotDeletableError,
} from "./chart";

const TEST_ORG_NAME = "__chart_service_test";

async function setup() {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `provider-${Date.now()}@example.test`, fullName: "Dr Test", role: "provider" })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role: "provider" };

  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();

  const [surfaceCode] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "FILL-TEST", shortName: "Test filling", category: "restorative", appliesTo: "surface", surfacesRequired: true })
    .returning();
  const [toothCode] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "EXT-TEST", shortName: "Test extraction", category: "oral_surgery", appliesTo: "tooth" })
    .returning();
  const [quadrantCode] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "SCALE-TEST", shortName: "Test scale", category: "periodontic", appliesTo: "quadrant" })
    .returning();

  return { org, actor, patient, user, surfaceCode, toothCode, quadrantCode };
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

describe("createProcedure", () => {
  afterEach(cleanup);

  it("creates a planned procedure with no price for a surface-scoped code", async () => {
    const { actor, patient, surfaceCode } = await setup();

    const procedure = await createProcedure(actor, patient.id, {
      procedure_code_id: surfaceCode.id,
      tooth: "26",
      surfaces: ["O"],
    });

    expect(procedure.status).toBe("planned");
    expect(procedure.price).toBeNull();
    expect(procedure.feeScheduleId).toBeNull();
  });

  it("rejects a surface-scoped code posted without surfaces", async () => {
    const { actor, patient, surfaceCode } = await setup();

    await expect(createProcedure(actor, patient.id, { procedure_code_id: surfaceCode.id, tooth: "26" })).rejects.toThrow(
      ProcedureScopeMismatchError,
    );
  });

  it("rejects a tooth-scoped code posted with surfaces", async () => {
    const { actor, patient, toothCode } = await setup();

    await expect(
      createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26", surfaces: ["O"] }),
    ).rejects.toThrow(ProcedureScopeMismatchError);
  });

  it("rejects a quadrant-scoped code posted with a tooth instead of a quadrant", async () => {
    const { actor, patient, quadrantCode } = await setup();

    await expect(createProcedure(actor, patient.id, { procedure_code_id: quadrantCode.id, tooth: "26" })).rejects.toThrow(
      ProcedureScopeMismatchError,
    );
  });

  it("rejects an occlusal surface on a front tooth — PROCEDURE_INVALID_SURFACE", async () => {
    const { actor, patient, surfaceCode } = await setup();

    await expect(
      createProcedure(actor, patient.id, { procedure_code_id: surfaceCode.id, tooth: "11", surfaces: ["O"] }),
    ).rejects.toThrow(ProcedureInvalidSurfaceError);
  });

  it("defaults the provider to the actor when they have a provider profile", async () => {
    const { org, actor, patient, user, toothCode } = await setup();
    await adminDb.insert(providerProfiles).values({ organizationId: org.id, userId: user.id });

    const procedure = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });

    expect(procedure.providerId).toBe(user.id);
  });

  it("leaves the provider null when the actor has no provider profile and none was given", async () => {
    const { actor, patient, toothCode } = await setup();

    const procedure = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });

    expect(procedure.providerId).toBeNull();
  });

  it("throws PatientNotFoundError for a patient belonging to another org", async () => {
    const { actor, toothCode } = await setup();
    const [otherOrg] = await adminDb.insert(organizations).values({ name: "__chart_service_test_other" }).returning();
    const [otherPatient] = await adminDb
      .insert(patients)
      .values({ organizationId: otherOrg.id, patientNumber: "P-0001", firstName: "Other", lastName: "Org", phone: "9000000001" })
      .returning();

    await expect(createProcedure(actor, otherPatient.id, { procedure_code_id: toothCode.id, tooth: "26" })).rejects.toThrow(
      PatientNotFoundError,
    );

    await wipeOrganizationData(adminDb, otherOrg.id);
    await adminDb.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});

describe("updateProcedureStatus", () => {
  afterEach(cleanup);

  it("walks the full legal lifecycle, stamping completed_at and invoiced_at", async () => {
    const { actor, patient, toothCode } = await setup();
    const created = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });

    const accepted = await updateProcedureStatus(actor, created.id, "accepted");
    expect(accepted.status).toBe("accepted");

    const scheduled = await updateProcedureStatus(actor, accepted.id, "scheduled");
    expect(scheduled.status).toBe("scheduled");

    const completed = await updateProcedureStatus(actor, scheduled.id, "completed");
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();

    const invoiced = await updateProcedureStatus(actor, completed.id, "invoiced");
    expect(invoiced.status).toBe("invoiced");
    expect(invoiced.invoicedAt).not.toBeNull();
  });

  // `scheduled` is optional: nothing links procedures to appointments in the pilot, so work
  // done chairside must complete straight from the chart — from `accepted` (a plan item) or
  // from `planned` (charted and done the same visit, never planned). Without this an accepted
  // plan could never complete and nothing could ever be invoiced.
  it("completes directly from planned or accepted, without the scheduled step", async () => {
    const { actor, patient, toothCode } = await setup();

    const walkIn = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });
    const doneToday = await updateProcedureStatus(actor, walkIn.id, "completed");
    expect(doneToday.status).toBe("completed");
    expect(doneToday.completedAt).not.toBeNull();

    const planned = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "36" });
    const accepted = await updateProcedureStatus(actor, planned.id, "accepted");
    const completed = await updateProcedureStatus(actor, accepted.id, "completed");
    expect(completed.status).toBe("completed");
  });

  it("rejects an illegal transition — an invoiced procedure can't be changed", async () => {
    const { actor, patient, toothCode } = await setup();
    let procedure = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });
    for (const to of ["accepted", "scheduled", "completed", "invoiced"] as const) {
      procedure = await updateProcedureStatus(actor, procedure.id, to);
    }

    await expect(updateProcedureStatus(actor, procedure.id, "cancelled")).rejects.toThrow(IllegalProcedureTransitionError);
  });

  it("throws ProcedureNotFoundError for a procedure in another org", async () => {
    const { actor } = await setup();
    await expect(updateProcedureStatus(actor, "00000000-0000-0000-0000-000000000000", "accepted")).rejects.toThrow(
      ProcedureNotFoundError,
    );
  });
});

describe("updateProcedureContent", () => {
  afterEach(cleanup);

  it("amends a planned procedure in place", async () => {
    const { actor, patient, toothCode } = await setup();
    const created = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26", note: "Original" });

    const amended = await updateProcedureContent(actor, created.id, { note: "Corrected tooth number" });

    expect(amended.id).toBe(created.id);
    expect(amended.note).toBe("Corrected tooth number");
  });

  it("supersedes an invoiced procedure instead of mutating it — ADR-0002", async () => {
    const { actor, patient, toothCode } = await setup();
    let procedure = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });
    for (const to of ["accepted", "scheduled", "completed", "invoiced"] as const) {
      procedure = await updateProcedureStatus(actor, procedure.id, to);
    }

    const amended = await updateProcedureContent(actor, procedure.id, { note: "Redo — margin failed" });

    expect(amended.id).not.toBe(procedure.id);
    expect(amended.status).toBe("planned");
    expect(amended.note).toBe("Redo — margin failed");

    const [original] = await dbForRequest(actor.organizationId, (tx) =>
      tx.select().from(chartedProcedures).where(eq(chartedProcedures.id, procedure.id)).limit(1),
    );
    expect(original?.status).toBe("invoiced");
    expect(original?.supersededById).toBe(amended.id);
  });
});

describe("deleteProcedure", () => {
  afterEach(cleanup);

  it("deletes a planned procedure", async () => {
    const { actor, patient, toothCode } = await setup();
    const created = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });

    await deleteProcedure(actor, created.id);

    const { procedures } = await getPatientChart(actor, patient.id);
    expect(procedures.find((p) => p.id === created.id)).toBeUndefined();
  });

  it("rejects deleting an accepted procedure — PROCEDURE_NOT_DELETABLE", async () => {
    const { actor, patient, toothCode } = await setup();
    const created = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });
    const accepted = await updateProcedureStatus(actor, created.id, "accepted");

    await expect(deleteProcedure(actor, accepted.id)).rejects.toThrow(ProcedureNotDeletableError);
  });

  it("rejects deleting an invoiced procedure — PROCEDURE_ALREADY_INVOICED", async () => {
    const { actor, patient, toothCode } = await setup();
    let procedure = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });
    for (const to of ["accepted", "scheduled", "completed", "invoiced"] as const) {
      procedure = await updateProcedureStatus(actor, procedure.id, to);
    }

    await expect(deleteProcedure(actor, procedure.id)).rejects.toThrow(ProcedureAlreadyInvoicedError);
  });
});

describe("getToothState", () => {
  afterEach(cleanup);

  it("layers a clinical finding and a procedure together for one tooth", async () => {
    const { actor, patient, surfaceCode } = await setup();
    await createCondition(actor, patient.id, { tooth: "26", surfaces: ["O"], condition_type: "caries" });
    await createProcedure(actor, patient.id, { procedure_code_id: surfaceCode.id, tooth: "26", surfaces: ["O"] });

    const state = await dbForRequest(actor.organizationId, (tx) => getToothState(tx, patient.id, "26"));

    expect(state.condition?.conditionType).toBe("caries");
    expect(state.procedures).toHaveLength(1);
    expect(state.isMissing).toBe(false);
    expect(state.existingRestoration).toBeNull();
  });

  it("surfaces existing-restoration conditions as whole-tooth state, not as the clinical finding", async () => {
    const { actor, patient } = await setup();
    await createCondition(actor, patient.id, { tooth: "46", condition_type: "existing_crown" });

    const state = await dbForRequest(actor.organizationId, (tx) => getToothState(tx, patient.id, "46"));

    expect(state.condition).toBeNull();
    expect(state.existingRestoration).toBe("existing_crown");
  });

  it("excludes resolved conditions and cancelled procedures from current state", async () => {
    const { actor, patient, toothCode } = await setup();
    const condition = await createCondition(actor, patient.id, { tooth: "26", condition_type: "fracture" });
    await updateCondition(actor, condition.id, { resolve: true });

    const procedure = await createProcedure(actor, patient.id, { procedure_code_id: toothCode.id, tooth: "26" });
    await updateProcedureStatus(actor, procedure.id, "cancelled");

    const state = await dbForRequest(actor.organizationId, (tx) => getToothState(tx, patient.id, "26"));

    expect(state.condition).toBeNull();
    expect(state.procedures).toHaveLength(0);
  });
});
