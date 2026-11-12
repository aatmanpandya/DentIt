import { eq, and, ne, isNull, inArray, desc } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import {
  chartedConditions,
  chartedProcedures,
  procedureCodes,
  providerProfiles,
  patients,
  treatmentPlans,
  treatmentPlanPhases,
  treatmentPlanItems,
} from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { isValidFdiTooth, validSurfacesForTooth } from "@/server/lib/tooth-notation";
import { writeAudit } from "./audit";
import { PatientNotFoundError } from "./patients";
import { ProcedureCodeNotFoundError } from "./catalog";
import type { RequestActor } from "@/server/lib/request-auth";

export { PatientNotFoundError, ProcedureCodeNotFoundError };

export class ConditionNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Condition not found.");
    this.name = "ConditionNotFoundError";
  }
}

export class ProcedureNotFoundError extends Error {
  constructor() {
    super("Procedure not found.");
    this.name = "ProcedureNotFoundError";
  }
}

// 422 — the tooth string isn't a real FDI code. Zod can't check this (it needs the
// lookup table in tooth-notation.ts), so it's a service-layer rule, not a schema one.
export class InvalidToothError extends Error {
  constructor(tooth: string) {
    super(`"${tooth}" isn't a valid tooth.`);
    this.name = "InvalidToothError";
  }
}

// 422 — PROCEDURE_SCOPE_MISMATCH. What was sent doesn't match the code's applies_to.
export class ProcedureScopeMismatchError extends Error {
  constructor(shortName: string, needs: string) {
    super(`${shortName} needs ${needs}.`);
    this.name = "ProcedureScopeMismatchError";
  }
}

// 422 — PROCEDURE_INVALID_SURFACE. Exact wording per docs/specs/validation-and-errors.md.
export class ProcedureInvalidSurfaceError extends Error {
  constructor(tooth: string, surface: string) {
    const isAnterior = validSurfacesForTooth(tooth).includes("I");
    super(
      surface === "O" && isAnterior
        ? `Tooth ${tooth} is a front tooth — it has an incisal surface, not an occlusal one.`
        : surface === "I" && !isAnterior
          ? `Tooth ${tooth} is a back tooth — it has an occlusal surface, not an incisal one.`
          : `Surface ${surface} isn't valid for tooth ${tooth}.`,
    );
    this.name = "ProcedureInvalidSurfaceError";
  }
}

// 422 — PROCEDURE_ILLEGAL_TRANSITION. See docs/adr/0002 for the lifecycle order.
export class IllegalProcedureTransitionError extends Error {
  constructor(from: string, to: string, legal: string[]) {
    super(
      legal.length === 0
        ? `A ${from} procedure can't be changed.`
        : `Can't move from ${from} to ${to}. Legal next steps: ${legal.join(", ")}.`,
    );
    this.name = "IllegalProcedureTransitionError";
  }
}

// 409 — PROCEDURE_ALREADY_INVOICED.
export class ProcedureAlreadyInvoicedError extends Error {
  constructor() {
    super("This procedure has already been invoiced and can't be deleted.");
    this.name = "ProcedureAlreadyInvoicedError";
  }
}

// 422 — PROCEDURE_NOT_DELETABLE. Anything past `planned` goes through cancel, not delete.
export class ProcedureNotDeletableError extends Error {
  constructor() {
    super("Only a planned procedure can be deleted — cancel it instead.");
    this.name = "ProcedureNotDeletableError";
  }
}

export type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

// `scheduled` is an optional step, not a gate: nothing links procedures to appointments in
// the pilot, so work done chairside completes straight from the chart — from `accepted` (a
// plan item) or from `planned` (charted and done the same visit; priced at invoicing, per
// odontogram.md). Decided 12 Nov 2026; see docs/bug-log.md entry 3.
const LEGAL_PROCEDURE_TRANSITIONS: Record<string, string[]> = {
  planned: ["accepted", "completed", "cancelled"],
  accepted: ["scheduled", "completed", "cancelled"],
  scheduled: ["completed", "cancelled"],
  completed: ["invoiced"],
  invoiced: [],
  cancelled: [],
};

// Whole-tooth-state condition types — see docs/specs/odontogram.md's "Mixed / adult /
// primary dentition" and "Existing restorations at intake" sections. Kept out of the
// clinical-finding read (getToothState's `condition`) since they're chart-level facts,
// not something the charting panel's condition picker surfaces the same way.
const WHOLE_TOOTH_CONDITION_TYPES = new Set([
  "missing",
  "unerupted",
  "exfoliated",
  "existing_crown",
  "existing_rct",
  "existing_restoration",
]);

async function requirePatient(tx: Tx, actor: RequestActor, patientId: string) {
  const [row] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, actor.organizationId), isNull(patients.deletedAt)))
    .limit(1);
  if (!row) throw new PatientNotFoundError();
  return row;
}

async function requireCondition(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(chartedConditions)
    .where(and(eq(chartedConditions.id, id), eq(chartedConditions.organizationId, actor.organizationId), isNull(chartedConditions.deletedAt)))
    .limit(1);
  if (!row) throw new ConditionNotFoundError();
  return row;
}

async function requireProcedure(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(chartedProcedures)
    .where(and(eq(chartedProcedures.id, id), eq(chartedProcedures.organizationId, actor.organizationId), isNull(chartedProcedures.deletedAt)))
    .limit(1);
  if (!row) throw new ProcedureNotFoundError();
  return row;
}

export async function requireProcedureCode(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(procedureCodes)
    .where(and(eq(procedureCodes.id, id), eq(procedureCodes.organizationId, actor.organizationId), isNull(procedureCodes.deletedAt)))
    .limit(1);
  if (!row) throw new ProcedureCodeNotFoundError();
  return row;
}

export async function defaultProviderId(tx: Tx, actor: RequestActor): Promise<string | null> {
  const [profile] = await tx
    .select({ userId: providerProfiles.userId })
    .from(providerProfiles)
    .where(and(eq(providerProfiles.organizationId, actor.organizationId), eq(providerProfiles.userId, actor.userId)))
    .limit(1);
  return profile ? actor.userId : null;
}

export interface ScopeInput {
  tooth?: string | null;
  surfaces?: string[] | null;
  quadrant?: string | null;
  arch?: string | null;
}

/**
 * PROCEDURE_SCOPE_MISMATCH — what was sent must match the code's applies_to exactly.
 * Exported for reuse by treatment-plans.ts's "add a treatment without charting
 * first" path (docs/specs/treatment-planning.md) — same rule, not re-derived.
 */
export function assertScopeMatches(code: typeof procedureCodes.$inferSelect, input: ScopeInput) {
  const hasTooth = !!input.tooth;
  const hasSurfaces = !!(input.surfaces && input.surfaces.length);
  const hasQuadrant = !!input.quadrant;
  const hasArch = !!input.arch;

  switch (code.appliesTo) {
    case "surface":
      if (!hasTooth || !hasSurfaces || hasQuadrant || hasArch) {
        throw new ProcedureScopeMismatchError(code.shortName, "a tooth and at least one surface, nothing else");
      }
      break;
    case "tooth":
      if (!hasTooth || hasSurfaces || hasQuadrant || hasArch) {
        throw new ProcedureScopeMismatchError(code.shortName, "a tooth and no surfaces, quadrant, or arch");
      }
      break;
    case "quadrant":
      if (!hasQuadrant || hasTooth || hasSurfaces || hasArch) {
        throw new ProcedureScopeMismatchError(code.shortName, "a quadrant and nothing else");
      }
      break;
    case "arch":
      if (!hasArch || hasTooth || hasSurfaces || hasQuadrant) {
        throw new ProcedureScopeMismatchError(code.shortName, "an arch and nothing else");
      }
      break;
    case "mouth":
      if (hasTooth || hasSurfaces || hasQuadrant || hasArch) {
        throw new ProcedureScopeMismatchError(code.shortName, "no tooth, surface, quadrant, or arch");
      }
      break;
  }
}

export function assertToothAndSurfacesValid(tooth: string | null | undefined, surfaces: string[] | null | undefined) {
  if (!tooth) return;
  if (!isValidFdiTooth(tooth)) throw new InvalidToothError(tooth);
  const valid = validSurfacesForTooth(tooth);
  for (const surface of surfaces ?? []) {
    if (!valid.includes(surface)) throw new ProcedureInvalidSurfaceError(tooth, surface);
  }
}

// --- Chart read ---

/**
 * GET /patients/:id/chart — one payload, per docs/specs/api-surface.md. Returns
 * everything (including resolved conditions and superseded/cancelled procedures) —
 * this is the raw feed the charting panel's per-tooth History section reads from.
 * "Current state only" is a different, narrower contract — see getToothState below.
 */
export async function getPatientChart(actor: RequestActor, patientId: string) {
  assertCan(actor.role, "odontogram", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);

    const conditions = await tx
      .select()
      .from(chartedConditions)
      .where(and(eq(chartedConditions.patientId, patientId), isNull(chartedConditions.deletedAt)))
      .orderBy(desc(chartedConditions.chartedAt));

    const procedures = await tx
      .select()
      .from(chartedProcedures)
      .where(and(eq(chartedProcedures.patientId, patientId), isNull(chartedProcedures.deletedAt)))
      .orderBy(desc(chartedProcedures.createdAt));

    return { conditions, procedures };
  });
}

export interface ToothState {
  tooth: string;
  condition: typeof chartedConditions.$inferSelect | null;
  procedures: (typeof chartedProcedures.$inferSelect)[];
  isMissing: boolean;
  isUnerupted: boolean;
  isExfoliated: boolean;
  existingRestoration: string | null;
}

/**
 * The shared read contract — docs/specs/odontogram.md's "Current state vs history, and
 * the read contract". Computes "current state only" for one tooth: the latest active
 * clinical finding, every non-cancelled/non-superseded procedure, and whole-tooth-state
 * flags. Used by the Odontogram and, from Day 14-17, Perio's auto-skip logic — both call
 * this, neither re-derives it. Takes an already tenant-scoped `tx`, not an `actor`, so a
 * caller in its own `dbForRequest` transaction (Perio's future service) can call it
 * directly; RLS on `tx` is what scopes the query, per src/server/db/tenant.ts.
 */
export async function getToothState(tx: Tx, patientId: string, tooth: string): Promise<ToothState> {
  const conditions = await tx
    .select()
    .from(chartedConditions)
    .where(
      and(
        eq(chartedConditions.patientId, patientId),
        eq(chartedConditions.tooth, tooth),
        isNull(chartedConditions.resolvedAt),
        isNull(chartedConditions.deletedAt),
      ),
    )
    .orderBy(desc(chartedConditions.chartedAt));

  const procedures = await tx
    .select()
    .from(chartedProcedures)
    .where(
      and(
        eq(chartedProcedures.patientId, patientId),
        eq(chartedProcedures.tooth, tooth),
        ne(chartedProcedures.status, "cancelled"),
        isNull(chartedProcedures.supersededById),
        isNull(chartedProcedures.deletedAt),
      ),
    )
    .orderBy(desc(chartedProcedures.createdAt));

  const wholeTooth = conditions.filter((c) => WHOLE_TOOTH_CONDITION_TYPES.has(c.conditionType));
  const clinicalFinding = conditions.find((c) => !WHOLE_TOOTH_CONDITION_TYPES.has(c.conditionType)) ?? null;
  const existingRestoration =
    wholeTooth.find((c) => c.conditionType === "existing_crown" || c.conditionType === "existing_rct" || c.conditionType === "existing_restoration")
      ?.conditionType ?? null;

  return {
    tooth,
    condition: clinicalFinding,
    procedures,
    isMissing: wholeTooth.some((c) => c.conditionType === "missing"),
    isUnerupted: wholeTooth.some((c) => c.conditionType === "unerupted"),
    isExfoliated: wholeTooth.some((c) => c.conditionType === "exfoliated"),
    existingRestoration,
  };
}

// --- Conditions ---

export interface CreateConditionInput {
  tooth?: string | null;
  surfaces?: string[] | null;
  condition_type: string;
  note?: string | null;
}

export async function createCondition(actor: RequestActor, patientId: string, input: CreateConditionInput) {
  assertCan(actor.role, "odontogram", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);
    if (input.tooth && !isValidFdiTooth(input.tooth)) throw new InvalidToothError(input.tooth);

    const [condition] = await tx
      .insert(chartedConditions)
      .values({
        organizationId: actor.organizationId,
        patientId,
        tooth: input.tooth ?? null,
        surfaces: input.surfaces ?? null,
        conditionType: input.condition_type,
        note: input.note ?? null,
        chartedBy: actor.userId,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "charted_condition",
      entityId: condition.id,
      action: "create",
      after: condition,
    });

    return condition;
  });
}

export interface UpdateConditionInput {
  resolve?: boolean;
  note?: string | null;
}

/** Resolving is the only "status change" a condition has — a finding is either active or resolved. */
export async function updateCondition(actor: RequestActor, id: string, input: UpdateConditionInput) {
  assertCan(actor.role, "odontogram", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireCondition(tx, actor, id);

    const patch: Partial<typeof chartedConditions.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.resolve !== undefined) patch.resolvedAt = input.resolve ? new Date() : null;
    if (input.note !== undefined) patch.note = input.note;

    const [after] = await tx.update(chartedConditions).set(patch).where(eq(chartedConditions.id, id)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "charted_condition",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

// --- Procedures ---

export interface CreateProcedureInput {
  procedure_code_id: string;
  tooth?: string | null;
  surfaces?: string[] | null;
  quadrant?: string | null;
  arch?: string | null;
  provider_id?: string | null;
  note?: string | null;
}

export async function createProcedure(actor: RequestActor, patientId: string, input: CreateProcedureInput) {
  assertCan(actor.role, "odontogram", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);
    const code = await requireProcedureCode(tx, actor, input.procedure_code_id);
    assertScopeMatches(code, input);
    assertToothAndSurfacesValid(input.tooth, input.surfaces);

    const providerId = input.provider_id !== undefined ? input.provider_id : await defaultProviderId(tx, actor);

    // price/feeScheduleId always null at charting time — entered manually later, at the
    // invoicing stage, once the procedure is completed. See docs/specs/odontogram.md.
    const [procedure] = await tx
      .insert(chartedProcedures)
      .values({
        organizationId: actor.organizationId,
        patientId,
        procedureCodeId: code.id,
        tooth: input.tooth ?? null,
        surfaces: input.surfaces ?? null,
        quadrant: input.quadrant ?? null,
        arch: input.arch ?? null,
        status: "planned",
        providerId,
        price: null,
        feeScheduleId: null,
        note: input.note ?? null,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "charted_procedure",
      entityId: procedure.id,
      action: "create",
      after: procedure,
    });

    return procedure;
  });
}

/**
 * A treatment plan's `completed` status is derived, never set directly — see
 * docs/specs/treatment-planning.md's "Plan lifecycle" section. The moment a procedure
 * completes, check whether it's the last incomplete item on some plan and flip that
 * plan if so. No cron: this is the only place a charted_procedure reaches `completed`.
 */
async function derivePlanCompletion(tx: Tx, actor: RequestActor, chartedProcedureId: string) {
  const [item] = await tx
    .select({ planId: treatmentPlanPhases.treatmentPlanId })
    .from(treatmentPlanItems)
    .innerJoin(treatmentPlanPhases, eq(treatmentPlanItems.treatmentPlanPhaseId, treatmentPlanPhases.id))
    .where(eq(treatmentPlanItems.chartedProcedureId, chartedProcedureId))
    .limit(1);
  if (!item) return;

  const beforePlan = await tx
    .select()
    .from(treatmentPlans)
    .where(eq(treatmentPlans.id, item.planId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!beforePlan || beforePlan.status !== "accepted") return;

  const siblingItems = await tx
    .select({ chartedProcedureId: treatmentPlanItems.chartedProcedureId })
    .from(treatmentPlanItems)
    .innerJoin(treatmentPlanPhases, eq(treatmentPlanItems.treatmentPlanPhaseId, treatmentPlanPhases.id))
    .where(eq(treatmentPlanPhases.treatmentPlanId, item.planId));

  // A still-deferred sibling (chartedProcedureId null) shouldn't exist on an
  // `accepted` plan — every item is promoted at accept, see treatment-plans.ts's
  // acceptTreatmentPlan — but if one somehow does, that's "not all completed" by
  // definition, not something to silently skip past.
  const linkedIds = siblingItems.flatMap((s) => (s.chartedProcedureId ? [s.chartedProcedureId] : []));
  if (linkedIds.length !== siblingItems.length) return;

  const siblingProcedures = await tx
    .select({ status: chartedProcedures.status })
    .from(chartedProcedures)
    .where(inArray(chartedProcedures.id, linkedIds));

  const allCompleted = siblingProcedures.length > 0 && siblingProcedures.every((p) => p.status === "completed");
  if (!allCompleted) return;

  const [afterPlan] = await tx
    .update(treatmentPlans)
    .set({ status: "completed", updatedBy: actor.userId, updatedAt: new Date() })
    .where(eq(treatmentPlans.id, item.planId))
    .returning();

  await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
    entityType: "treatment_plan",
    entityId: item.planId,
    action: "update",
    before: beforePlan,
    after: afterPlan,
  });
}

export async function updateProcedureStatus(actor: RequestActor, id: string, toStatus: string) {
  assertCan(actor.role, "odontogram", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireProcedure(tx, actor, id);
    const legal = LEGAL_PROCEDURE_TRANSITIONS[before.status] ?? [];
    if (!legal.includes(toStatus)) throw new IllegalProcedureTransitionError(before.status, toStatus, legal);

    const now = new Date();
    const patch: Partial<typeof chartedProcedures.$inferInsert> = {
      status: toStatus as (typeof chartedProcedures.$inferInsert)["status"],
      updatedBy: actor.userId,
      updatedAt: now,
    };
    if (toStatus === "completed") patch.completedAt = now;
    if (toStatus === "invoiced") patch.invoicedAt = now;

    const [after] = await tx.update(chartedProcedures).set(patch).where(eq(chartedProcedures.id, id)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "charted_procedure",
      entityId: id,
      action: "update",
      before,
      after,
    });

    if (toStatus === "completed") await derivePlanCompletion(tx, actor, id);

    return after;
  });
}

/** Thin convenience wrapper over the transition — POST /procedures/:id/complete. */
export async function completeProcedure(actor: RequestActor, id: string) {
  return updateProcedureStatus(actor, id, "completed");
}

export interface UpdateProcedureContentInput {
  tooth?: string | null;
  surfaces?: string[] | null;
  quadrant?: string | null;
  arch?: string | null;
  provider_id?: string | null;
  note?: string | null;
}

/**
 * The amend path. If the procedure is `invoiced`, ADR-0002 forbids mutating it in
 * place: this inserts a new row (starting at `planned` — a fresh proposal re-entering
 * the lifecycle, not a resumption) and marks the original `supersededById`. Otherwise
 * it's a plain in-place patch.
 */
export async function updateProcedureContent(actor: RequestActor, id: string, input: UpdateProcedureContentInput) {
  assertCan(actor.role, "odontogram", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireProcedure(tx, actor, id);
    const code = await requireProcedureCode(tx, actor, before.procedureCodeId);

    const effective: ScopeInput = {
      tooth: input.tooth !== undefined ? input.tooth : before.tooth,
      surfaces: input.surfaces !== undefined ? input.surfaces : before.surfaces,
      quadrant: input.quadrant !== undefined ? input.quadrant : before.quadrant,
      arch: input.arch !== undefined ? input.arch : before.arch,
    };
    assertScopeMatches(code, effective);
    assertToothAndSurfacesValid(effective.tooth, effective.surfaces);

    if (before.status === "invoiced") {
      const [created] = await tx
        .insert(chartedProcedures)
        .values({
          organizationId: actor.organizationId,
          patientId: before.patientId,
          procedureCodeId: before.procedureCodeId,
          tooth: effective.tooth ?? null,
          surfaces: effective.surfaces ?? null,
          quadrant: effective.quadrant ?? null,
          arch: effective.arch ?? null,
          status: "planned",
          providerId: input.provider_id !== undefined ? input.provider_id : before.providerId,
          price: null,
          feeScheduleId: null,
          note: input.note !== undefined ? input.note : before.note,
          createdBy: actor.userId,
        })
        .returning();

      const [supersededAfter] = await tx
        .update(chartedProcedures)
        .set({ supersededById: created.id, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(chartedProcedures.id, id))
        .returning();

      await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
        entityType: "charted_procedure",
        entityId: created.id,
        action: "create",
        after: created,
      });
      await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
        entityType: "charted_procedure",
        entityId: id,
        action: "update",
        before,
        after: supersededAfter,
      });

      return created;
    }

    const patch: Partial<typeof chartedProcedures.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.tooth !== undefined) patch.tooth = input.tooth;
    if (input.surfaces !== undefined) patch.surfaces = input.surfaces;
    if (input.quadrant !== undefined) patch.quadrant = input.quadrant;
    if (input.arch !== undefined) patch.arch = input.arch;
    if (input.provider_id !== undefined) patch.providerId = input.provider_id;
    if (input.note !== undefined) patch.note = input.note;

    const [after] = await tx.update(chartedProcedures).set(patch).where(eq(chartedProcedures.id, id)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "charted_procedure",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/** DELETE /procedures/:id — planned only; otherwise cancel via updateProcedureStatus. */
export async function deleteProcedure(actor: RequestActor, id: string) {
  assertCan(actor.role, "odontogram", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireProcedure(tx, actor, id);
    if (before.status === "invoiced") throw new ProcedureAlreadyInvoicedError();
    if (before.status !== "planned") throw new ProcedureNotDeletableError();

    await tx.delete(chartedProcedures).where(eq(chartedProcedures.id, id));

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "charted_procedure",
      entityId: id,
      action: "delete",
      before,
    });
  });
}
