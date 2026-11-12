import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, patients, procedureCodes, chartedProcedures, treatmentPlanItems } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { createProcedure, completeProcedure, updateProcedureStatus } from "./chart";
import { createFeeSchedule, upsertFeeScheduleItems } from "./catalog";
import {
  createTreatmentPlan,
  createPhase,
  addItemToPhase,
  removeItem,
  reorderPhase,
  reorderItem,
  getTreatmentPlan,
  presentTreatmentPlan,
  acceptTreatmentPlan,
  updateTreatmentPlan,
  TreatmentPlanEmptyError,
  TreatmentPlanLockedError,
  TreatmentPlanItemNotPlannedError,
  IllegalTreatmentPlanTransitionError,
  FeeScheduleNoPriceError,
} from "./treatment-plans";

const TEST_ORG_NAME = "__treatment_plans_service_test";

async function setup() {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `owner-${Date.now()}@example.test`, fullName: "Dr Test", role: "owner" })
    .returning();
  // owner (not provider): needs write on fee_schedules too, for the price-snapshot
  // setup below — provider can't write fee_schedules per the RBAC matrix.
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role: "owner" };

  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();

  const [code] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "FILL-TEST", shortName: "Test filling", category: "restorative", appliesTo: "tooth" })
    .returning();
  const [unpricedCode] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "CROWN-TEST", shortName: "Test crown", category: "prosthodontic", appliesTo: "tooth" })
    .returning();

  const schedule = await createFeeSchedule(actor, { name: "Standard", effective_from: "2026-01-01", is_default: true });
  await upsertFeeScheduleItems(actor, schedule.id, [{ procedure_code_id: code.id, price: "500.00" }]);

  return { org, actor, patient, code, unpricedCode, schedule };
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function plannedProcedure(actor: RequestActor, patientId: string, procedureCodeId: string, tooth = "16") {
  return createProcedure(actor, patientId, { procedure_code_id: procedureCodeId, tooth });
}

describe("createTreatmentPlan", () => {
  afterEach(cleanup);

  it("creates a draft plan with a default phase", async () => {
    const { actor, patient } = await setup();

    const detail = await createTreatmentPlan(actor, patient.id, { name: "Full mouth plan" });

    expect(detail.plan.status).toBe("draft");
    expect(detail.phases).toHaveLength(1);
    expect(detail.phases[0].phase.name).toBe("Phase 1");
    expect(detail.phases[0].items).toHaveLength(0);
  });
});

describe("addItemToPhase", () => {
  afterEach(cleanup);

  it("adds a planned procedure and prices it live", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, code.id);

    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });
    const refreshed = await getTreatmentPlan(actor, detail.plan.id);

    expect(refreshed.phases[0].items).toHaveLength(1);
    expect(refreshed.phases[0].items[0].price).toBe("500.00");
    expect(refreshed.phases[0].items[0].item.chartedProcedureId).toBe(procedure.id);
    expect(refreshed.phases[0].items[0].procedureStatus).toBe("planned");
  });

  it("shows an unpriced item as null, not an error", async () => {
    const { actor, patient, unpricedCode } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, unpricedCode.id);

    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });
    const refreshed = await getTreatmentPlan(actor, detail.plan.id);

    expect(refreshed.phases[0].items[0].price).toBeNull();
  });

  it("rejects a procedure that isn't planned", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, code.id);
    await updateProcedureStatus(actor, procedure.id, "cancelled");

    await expect(addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id })).rejects.toThrow(
      TreatmentPlanItemNotPlannedError,
    );
  });

  it("rejects adding the same still-planned procedure to the plan twice", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, code.id);
    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });

    await expect(
      addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id }),
    ).rejects.toThrow(TreatmentPlanItemNotPlannedError);
  });

  it("rejects a procedure belonging to a different patient (no existence oracle)", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });

    const [otherPatient] = await adminDb
      .insert(patients)
      .values({ organizationId: actor.organizationId, patientNumber: "P-0002", firstName: "Other", lastName: "Patient", phone: "9000000001" })
      .returning();
    const otherProcedure = await plannedProcedure(actor, otherPatient.id, code.id);

    await expect(
      addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: otherProcedure.id }),
    ).rejects.toThrow(TreatmentPlanItemNotPlannedError);
  });
});

describe("adding a treatment without charting first", () => {
  afterEach(cleanup);

  it("chart_now: false adds a deferred item with no charted_procedure yet, still live-priced", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });

    await addItemToPhase(actor, detail.phases[0].phase.id, {
      new_procedure: { procedure_code_id: code.id, tooth: "16", chart_now: false },
    });
    const refreshed = await getTreatmentPlan(actor, detail.plan.id);

    expect(refreshed.phases[0].items).toHaveLength(1);
    const item = refreshed.phases[0].items[0];
    expect(item.item.chartedProcedureId).toBeNull();
    expect(item.tooth).toBe("16");
    expect(item.price).toBe("500.00");
    expect(item.procedureStatus).toBeNull();

    const chartedRows = await adminDb.select().from(chartedProcedures).where(eq(chartedProcedures.patientId, patient.id));
    expect(chartedRows).toHaveLength(0);
  });

  it("chart_now: true creates a real charted_procedure immediately", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });

    const item = await addItemToPhase(actor, detail.phases[0].phase.id, {
      new_procedure: { procedure_code_id: code.id, tooth: "16", chart_now: true },
    });

    expect(item.chartedProcedureId).not.toBeNull();
    const [procedure] = await adminDb.select().from(chartedProcedures).where(eq(chartedProcedures.id, item.chartedProcedureId as string));
    expect(procedure.status).toBe("planned");
    expect(procedure.tooth).toBe("16");
  });

  it("chart_now: true requires odontogram write, not just treatment_plans write", async () => {
    const { patient, code, org } = await setup();
    const [adminUser] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: `admin-${Date.now()}@example.test`, fullName: "Admin", role: "admin" })
      .returning();
    // admin: treatment_plans write yes, odontogram write no — per the RBAC matrix.
    const adminActor: RequestActor = { userId: adminUser.id, organizationId: org.id, role: "admin" };
    const detail = await createTreatmentPlan(adminActor, patient.id, { name: "Plan" });

    await expect(
      addItemToPhase(adminActor, detail.phases[0].phase.id, {
        new_procedure: { procedure_code_id: code.id, tooth: "16", chart_now: true },
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("chart_now: false does NOT require odontogram write — a plan can be drafted with nothing charted", async () => {
    const { patient, code, org } = await setup();
    const [adminUser] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: `admin2-${Date.now()}@example.test`, fullName: "Admin", role: "admin" })
      .returning();
    const adminActor: RequestActor = { userId: adminUser.id, organizationId: org.id, role: "admin" };
    const detail = await createTreatmentPlan(adminActor, patient.id, { name: "Plan" });

    const item = await addItemToPhase(adminActor, detail.phases[0].phase.id, {
      new_procedure: { procedure_code_id: code.id, tooth: "16", chart_now: false },
    });
    expect(item.chartedProcedureId).toBeNull();
  });

  it("promotes a deferred item into a real, accepted charted_procedure at accept", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const item = await addItemToPhase(actor, detail.phases[0].phase.id, {
      new_procedure: { procedure_code_id: code.id, tooth: "16", chart_now: false },
    });
    await presentTreatmentPlan(actor, detail.plan.id);
    await acceptTreatmentPlan(actor, detail.plan.id);

    const refreshed = await getTreatmentPlan(actor, detail.plan.id);
    const promotedItem = refreshed.phases[0].items[0];
    expect(promotedItem.item.chartedProcedureId).not.toBeNull();
    expect(promotedItem.procedureStatus).toBe("accepted");
    expect(promotedItem.price).toBe("500.00");

    const [procedure] = await adminDb
      .select()
      .from(chartedProcedures)
      .where(eq(chartedProcedures.id, promotedItem.item.chartedProcedureId as string));
    expect(procedure.status).toBe("accepted");
    expect(procedure.tooth).toBe("16");
    expect(procedure.price).toBe("500.00");

    const [rawItem] = await adminDb.select().from(treatmentPlanItems).where(eq(treatmentPlanItems.id, item.id));
    expect(rawItem.procedureCodeId).toBeNull();
    expect(rawItem.tooth).toBeNull();
  });

  it("rolls back the whole accept, including promotion, if a deferred item is unpriced", async () => {
    const { actor, patient, unpricedCode } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    await addItemToPhase(actor, detail.phases[0].phase.id, {
      new_procedure: { procedure_code_id: unpricedCode.id, tooth: "16", chart_now: false },
    });
    await presentTreatmentPlan(actor, detail.plan.id);

    await expect(acceptTreatmentPlan(actor, detail.plan.id)).rejects.toThrow(FeeScheduleNoPriceError);

    const chartedRows = await adminDb.select().from(chartedProcedures).where(eq(chartedProcedures.patientId, patient.id));
    expect(chartedRows).toHaveLength(0);
    const refreshed = await getTreatmentPlan(actor, detail.plan.id);
    expect(refreshed.plan.status).toBe("presented");
    expect(refreshed.phases[0].items[0].item.chartedProcedureId).toBeNull();
  });
});

describe("presentTreatmentPlan", () => {
  afterEach(cleanup);

  it("rejects presenting an empty plan", async () => {
    const { actor, patient } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });

    await expect(presentTreatmentPlan(actor, detail.plan.id)).rejects.toThrow(TreatmentPlanEmptyError);
  });

  it("presents a plan with at least one item", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, code.id);
    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });

    const plan = await presentTreatmentPlan(actor, detail.plan.id);
    expect(plan.status).toBe("presented");
    expect(plan.presentedAt).not.toBeNull();
  });
});

describe("acceptTreatmentPlan", () => {
  afterEach(cleanup);

  async function presentedPlanWithItem(actor: RequestActor, patientId: string, procedureCodeId: string) {
    const detail = await createTreatmentPlan(actor, patientId, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patientId, procedureCodeId);
    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });
    await presentTreatmentPlan(actor, detail.plan.id);
    return { planId: detail.plan.id, procedure };
  }

  it("snapshots price and bulk-transitions the procedure to accepted", async () => {
    const { actor, patient, code } = await setup();
    const { planId, procedure } = await presentedPlanWithItem(actor, patient.id, code.id);

    const plan = await acceptTreatmentPlan(actor, planId, { signature_image: "data:image/png;base64,abc" });
    expect(plan.status).toBe("accepted");
    expect(plan.signatureImageKey).toBe("data:image/png;base64,abc");

    const [updatedProcedure] = await adminDb.select().from(chartedProcedures).where(eq(chartedProcedures.id, procedure.id));
    expect(updatedProcedure.status).toBe("accepted");
    expect(updatedProcedure.price).toBe("500.00");
    expect(updatedProcedure.feeScheduleId).not.toBeNull();
  });

  it("rolls back atomically if an item has no price", async () => {
    const { actor, patient, unpricedCode } = await setup();
    const { planId, procedure } = await presentedPlanWithItem(actor, patient.id, unpricedCode.id);

    await expect(acceptTreatmentPlan(actor, planId)).rejects.toThrow(FeeScheduleNoPriceError);

    const [unchangedProcedure] = await adminDb.select().from(chartedProcedures).where(eq(chartedProcedures.id, procedure.id));
    expect(unchangedProcedure.status).toBe("planned");
    const refreshed = await getTreatmentPlan(actor, planId);
    expect(refreshed.plan.status).toBe("presented");
  });

  it("rejects accepting an item that drifted off planned after presenting", async () => {
    const { actor, patient, code } = await setup();
    const { planId, procedure } = await presentedPlanWithItem(actor, patient.id, code.id);
    await updateProcedureStatus(actor, procedure.id, "cancelled");

    await expect(acceptTreatmentPlan(actor, planId)).rejects.toThrow(TreatmentPlanItemNotPlannedError);
  });

  it("rejects accepting a draft plan directly", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, code.id);
    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });

    await expect(acceptTreatmentPlan(actor, detail.plan.id)).rejects.toThrow(IllegalTreatmentPlanTransitionError);
  });
});

describe("editing lock", () => {
  afterEach(cleanup);

  it("blocks adding items, removing items, and phases once accepted", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procedure = await plannedProcedure(actor, patient.id, code.id);
    const item = await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procedure.id });
    await presentTreatmentPlan(actor, detail.plan.id);
    await acceptTreatmentPlan(actor, detail.plan.id);

    const anotherProcedure = await plannedProcedure(actor, patient.id, code.id, "17");
    await expect(
      addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: anotherProcedure.id }),
    ).rejects.toThrow(TreatmentPlanLockedError);
    await expect(removeItem(actor, item.id)).rejects.toThrow(TreatmentPlanLockedError);
    await expect(createPhase(actor, detail.plan.id, { name: "Phase 2" })).rejects.toThrow(TreatmentPlanLockedError);
    await expect(updateTreatmentPlan(actor, detail.plan.id, { name: "Renamed" })).rejects.toThrow(TreatmentPlanLockedError);
  });
});

describe("decline", () => {
  afterEach(cleanup);

  it("declines a draft plan via the double-duty PATCH", async () => {
    const { actor, patient } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });

    const plan = await updateTreatmentPlan(actor, detail.plan.id, { to_status: "declined" });
    expect(plan.status).toBe("declined");
  });
});

describe("reordering", () => {
  afterEach(cleanup);

  it("reorders phases within a plan", async () => {
    const { actor, patient } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const phase2 = await createPhase(actor, detail.plan.id, { name: "Phase 2" });

    await reorderPhase(actor, phase2.id, 0);
    const refreshed = await getTreatmentPlan(actor, detail.plan.id);

    expect(refreshed.phases.map((p) => p.phase.id)).toEqual([phase2.id, detail.phases[0].phase.id]);
  });

  it("reorders items within a phase", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procA = await plannedProcedure(actor, patient.id, code.id, "16");
    const procB = await plannedProcedure(actor, patient.id, code.id, "17");
    const itemA = await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procA.id });
    const itemB = await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procB.id });

    await reorderItem(actor, itemB.id, 0);
    const refreshed = await getTreatmentPlan(actor, detail.plan.id);

    expect(refreshed.phases[0].items.map((i) => i.item.id)).toEqual([itemB.id, itemA.id]);
  });
});

describe("derived plan completion", () => {
  afterEach(cleanup);

  it("flips the plan to completed once every item's procedure is completed", async () => {
    const { actor, patient, code } = await setup();
    const detail = await createTreatmentPlan(actor, patient.id, { name: "Plan" });
    const procA = await plannedProcedure(actor, patient.id, code.id, "16");
    const procB = await plannedProcedure(actor, patient.id, code.id, "17");
    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procA.id });
    await addItemToPhase(actor, detail.phases[0].phase.id, { charted_procedure_id: procB.id });
    await presentTreatmentPlan(actor, detail.plan.id);
    await acceptTreatmentPlan(actor, detail.plan.id);

    await updateProcedureStatus(actor, procA.id, "scheduled");
    await completeProcedure(actor, procA.id);
    let refreshed = await getTreatmentPlan(actor, detail.plan.id);
    expect(refreshed.plan.status).toBe("accepted");

    await updateProcedureStatus(actor, procB.id, "scheduled");
    await completeProcedure(actor, procB.id);
    refreshed = await getTreatmentPlan(actor, detail.plan.id);
    expect(refreshed.plan.status).toBe("completed");
  });
});
