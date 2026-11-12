import { eq, and, isNull, asc, desc, inArray } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import {
  treatmentPlans,
  treatmentPlanPhases,
  treatmentPlanItems,
  chartedProcedures,
  procedureCodes,
  patients,
} from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { writeAudit } from "./audit";
import { resolvePrice, FeeScheduleNoPriceError } from "./catalog";
import { PatientNotFoundError } from "./patients";
import {
  requireProcedureCode,
  defaultProviderId,
  assertScopeMatches,
  assertToothAndSurfacesValid,
  InvalidToothError,
  ProcedureCodeNotFoundError,
  ProcedureScopeMismatchError,
  ProcedureInvalidSurfaceError,
  type ScopeInput,
} from "./chart";
import type { RequestActor } from "@/server/lib/request-auth";

export {
  PatientNotFoundError,
  FeeScheduleNoPriceError,
  InvalidToothError,
  ProcedureCodeNotFoundError,
  ProcedureScopeMismatchError,
  ProcedureInvalidSurfaceError,
};

export class TreatmentPlanNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Treatment plan not found.");
    this.name = "TreatmentPlanNotFoundError";
  }
}

export class TreatmentPlanPhaseNotFoundError extends Error {
  constructor() {
    super("Phase not found.");
    this.name = "TreatmentPlanPhaseNotFoundError";
  }
}

export class TreatmentPlanItemNotFoundError extends Error {
  constructor() {
    super("Item not found.");
    this.name = "TreatmentPlanItemNotFoundError";
  }
}

// 422 — TREATMENT_PLAN_ILLEGAL_TRANSITION. `completed` never appears as a legal `to`
// here — it's derived in chart.ts's derivePlanCompletion, not a manual transition.
export class IllegalTreatmentPlanTransitionError extends Error {
  constructor(from: string, to: string, legal: string[]) {
    super(
      legal.length === 0
        ? `A ${from} plan can't be changed.`
        : `Can't move from ${from} to ${to}. Legal next steps: ${legal.join(", ")}.`,
    );
    this.name = "IllegalTreatmentPlanTransitionError";
  }
}

// 422 — TREATMENT_PLAN_LOCKED. Editable in draft/presented only, per
// docs/specs/treatment-planning.md — anything past that is a historical record.
export class TreatmentPlanLockedError extends Error {
  constructor() {
    super("This plan has already been accepted and can't be edited.");
    this.name = "TreatmentPlanLockedError";
  }
}

// 422 — TREATMENT_PLAN_EMPTY. Nothing to price or show a patient.
export class TreatmentPlanEmptyError extends Error {
  constructor() {
    super("Add at least one item before presenting this plan.");
    this.name = "TreatmentPlanEmptyError";
  }
}

// 422 — TREATMENT_PLAN_ITEM_NOT_PLANNED. Same message whether the procedure doesn't
// exist, belongs to another patient, or isn't `planned` — never a distinct error, so
// it can't be used as an existence oracle for another patient's procedures (same
// discipline as perio.ts's comparePerioExam cross-patient fix).
export class TreatmentPlanItemNotPlannedError extends Error {
  constructor() {
    super("This procedure is no longer available to add — it may already be on another plan or no longer planned.");
    this.name = "TreatmentPlanItemNotPlannedError";
  }
}

type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

// See docs/specs/treatment-planning.md's "Plan lifecycle" table.
const LEGAL_PLAN_TRANSITIONS: Record<string, string[]> = {
  draft: ["presented", "declined"],
  presented: ["accepted", "declined"],
  accepted: [],
  declined: [],
  completed: [],
};

const EDITABLE_STATUSES = new Set(["draft", "presented"]);

function assertLegalTransition(from: string, to: string) {
  const legal = LEGAL_PLAN_TRANSITIONS[from] ?? [];
  if (!legal.includes(to)) throw new IllegalTreatmentPlanTransitionError(from, to, legal);
}

function assertEditable(plan: typeof treatmentPlans.$inferSelect) {
  if (!EDITABLE_STATUSES.has(plan.status)) throw new TreatmentPlanLockedError();
}

async function requirePatient(tx: Tx, actor: RequestActor, patientId: string) {
  const [row] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, actor.organizationId), isNull(patients.deletedAt)))
    .limit(1);
  if (!row) throw new PatientNotFoundError();
  return row;
}

async function requirePlan(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(treatmentPlans)
    .where(and(eq(treatmentPlans.id, id), eq(treatmentPlans.organizationId, actor.organizationId), isNull(treatmentPlans.deletedAt)))
    .limit(1);
  if (!row) throw new TreatmentPlanNotFoundError();
  return row;
}

async function requirePhase(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(treatmentPlanPhases)
    .where(and(eq(treatmentPlanPhases.id, id), eq(treatmentPlanPhases.organizationId, actor.organizationId), isNull(treatmentPlanPhases.deletedAt)))
    .limit(1);
  if (!row) throw new TreatmentPlanPhaseNotFoundError();
  return row;
}

async function requireItem(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(treatmentPlanItems)
    .where(and(eq(treatmentPlanItems.id, id), eq(treatmentPlanItems.organizationId, actor.organizationId), isNull(treatmentPlanItems.deletedAt)))
    .limit(1);
  if (!row) throw new TreatmentPlanItemNotFoundError();
  return row;
}

/**
 * Only a `planned` procedure belonging to this plan's own patient can be added —
 * checked here, not left to a foreign key, since a cross-patient charted_procedure_id
 * would otherwise link silently. Same error regardless of which check fails; see
 * TreatmentPlanItemNotPlannedError above.
 */
async function requireAddableProcedure(tx: Tx, actor: RequestActor, patientId: string, chartedProcedureId: string) {
  const [row] = await tx
    .select()
    .from(chartedProcedures)
    .where(
      and(
        eq(chartedProcedures.id, chartedProcedureId),
        eq(chartedProcedures.organizationId, actor.organizationId),
        isNull(chartedProcedures.deletedAt),
      ),
    )
    .limit(1);
  if (!row || row.patientId !== patientId || row.status !== "planned") throw new TreatmentPlanItemNotPlannedError();
  return row;
}

// --- Read ---

// Two mutually-exclusive item sources — see the schema comment in
// src/server/db/schema/treatment-plans.ts and docs/specs/treatment-planning.md's
// "Adding a treatment without charting first". `procedureStatus` is null exactly
// when nothing's been charted yet (a deferred item); everything else is normalized
// to one shape regardless of which source it came from, so callers don't need to
// branch on it.
export interface TreatmentPlanItemDetail {
  item: typeof treatmentPlanItems.$inferSelect;
  procedureCodeId: string;
  procedureCode: typeof procedureCodes.$inferSelect;
  tooth: string | null;
  surfaces: string[] | null;
  procedureStatus: (typeof chartedProcedures.$inferSelect)["status"] | null;
  price: string | null;
}

export interface TreatmentPlanPhaseDetail {
  phase: typeof treatmentPlanPhases.$inferSelect;
  items: TreatmentPlanItemDetail[];
}

export interface TreatmentPlanDetail {
  plan: typeof treatmentPlans.$inferSelect;
  phases: TreatmentPlanPhaseDetail[];
}

/**
 * Live-priced while `draft`/`presented` (recomputed on every read via the same
 * fee-schedule path GET /pricing uses); reads the accept-time snapshot once the plan
 * is past that (a deferred item never reaches this branch with a snapshot — it's
 * promoted to a linked, priced item at accept, see acceptTreatmentPlan). An unpriced
 * code returns `null` rather than throwing — the builder shows it plainly as
 * unpriced, per docs/specs/treatment-planning.md; only `accept` itself treats a
 * missing price as a hard failure.
 */
async function resolveItemPrice(
  tx: Tx,
  actor: RequestActor,
  plan: typeof treatmentPlans.$inferSelect,
  procedureCodeId: string,
  snapshotPrice: string | null,
): Promise<string | null> {
  if (!EDITABLE_STATUSES.has(plan.status)) return snapshotPrice;
  try {
    const priced = await resolvePrice(tx, actor, { procedure_code_id: procedureCodeId });
    return priced.price;
  } catch (err) {
    if (err instanceof FeeScheduleNoPriceError) return null;
    throw err;
  }
}

async function loadDetail(tx: Tx, actor: RequestActor, plan: typeof treatmentPlans.$inferSelect): Promise<TreatmentPlanDetail> {
  const phases = await tx
    .select()
    .from(treatmentPlanPhases)
    .where(and(eq(treatmentPlanPhases.treatmentPlanId, plan.id), isNull(treatmentPlanPhases.deletedAt)))
    .orderBy(asc(treatmentPlanPhases.sequence));

  if (phases.length === 0) return { plan, phases: [] };

  const items = await tx
    .select()
    .from(treatmentPlanItems)
    .where(
      and(
        inArray(treatmentPlanItems.treatmentPlanPhaseId, phases.map((p) => p.id)),
        isNull(treatmentPlanItems.deletedAt),
      ),
    )
    .orderBy(asc(treatmentPlanItems.sequence));

  const linkedProcedureIds = [...new Set(items.flatMap((i) => (i.chartedProcedureId ? [i.chartedProcedureId] : [])))];
  const linkedProcedures = linkedProcedureIds.length
    ? await tx.select().from(chartedProcedures).where(inArray(chartedProcedures.id, linkedProcedureIds))
    : [];
  const procedureById = new Map(linkedProcedures.map((p) => [p.id, p]));

  const codeIds = [
    ...new Set(items.flatMap((i) => {
      const codeId = i.chartedProcedureId ? procedureById.get(i.chartedProcedureId)?.procedureCodeId : i.procedureCodeId;
      return codeId ? [codeId] : [];
    })),
  ];
  const codes = codeIds.length ? await tx.select().from(procedureCodes).where(inArray(procedureCodes.id, codeIds)) : [];
  const codeById = new Map(codes.map((c) => [c.id, c]));

  const itemsByPhase = new Map<string, TreatmentPlanItemDetail[]>();
  for (const item of items) {
    // Resolve to one normalized shape regardless of source — see the interface doc above.
    let procedureCodeId: string;
    let tooth: string | null;
    let surfaces: string[] | null;
    let procedureStatus: (typeof chartedProcedures.$inferSelect)["status"] | null;
    let snapshotPrice: string | null;

    if (item.chartedProcedureId) {
      const procedure = procedureById.get(item.chartedProcedureId);
      if (!procedure) continue; // FK guarantees this exists; guards TS narrowing only
      procedureCodeId = procedure.procedureCodeId;
      tooth = procedure.tooth;
      surfaces = procedure.surfaces;
      procedureStatus = procedure.status;
      snapshotPrice = procedure.price;
    } else {
      // Deferred — the CHECK constraint guarantees procedureCodeId is set here.
      procedureCodeId = item.procedureCodeId as string;
      tooth = item.tooth;
      surfaces = item.surfaces;
      procedureStatus = null;
      snapshotPrice = null;
    }

    const procedureCode = codeById.get(procedureCodeId);
    if (!procedureCode) continue;
    const price = await resolveItemPrice(tx, actor, plan, procedureCodeId, snapshotPrice);
    const list = itemsByPhase.get(item.treatmentPlanPhaseId) ?? [];
    list.push({ item, procedureCodeId, procedureCode, tooth, surfaces, procedureStatus, price });
    itemsByPhase.set(item.treatmentPlanPhaseId, list);
  }

  return { plan, phases: phases.map((phase) => ({ phase, items: itemsByPhase.get(phase.id) ?? [] })) };
}

export async function listPatientTreatmentPlans(actor: RequestActor, patientId: string) {
  assertCan(actor.role, "treatment_plans", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);
    return tx
      .select()
      .from(treatmentPlans)
      .where(and(eq(treatmentPlans.patientId, patientId), isNull(treatmentPlans.deletedAt)))
      .orderBy(desc(treatmentPlans.createdAt));
  });
}

/** GET /treatment-plans/:id — the full builder/presentation payload, one call. */
export async function getTreatmentPlan(actor: RequestActor, id: string): Promise<TreatmentPlanDetail> {
  assertCan(actor.role, "treatment_plans", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const plan = await requirePlan(tx, actor, id);
    return loadDetail(tx, actor, plan);
  });
}

export interface OrganizationTreatmentPlanRow {
  plan: typeof treatmentPlans.$inferSelect;
  patient: { id: string; firstName: string; lastName: string };
  // Each item's price through the same path the builder uses (live while editable, the
  // accept-time snapshot after) — null when unpriced. The serializer turns these into a
  // total with the same "never a partial figure" rule as the plan detail.
  itemPrices: (string | null)[];
}

const ORG_PLAN_LIST_LIMIT = 200;

/**
 * GET /treatment-plans — every patient's plans in the org, most recently updated first,
 * optionally filtered by status. Backs the side rail's "Treatment plans" page. Capped at
 * 200 rows: pilot clinics have a few dozen open plans, and pricing each is a per-item
 * fee-schedule lookup.
 */
export async function listOrganizationTreatmentPlans(
  actor: RequestActor,
  filter: { status?: (typeof treatmentPlans.$inferSelect)["status"] },
): Promise<OrganizationTreatmentPlanRow[]> {
  assertCan(actor.role, "treatment_plans", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const rows = await tx
      .select({ plan: treatmentPlans, patient: { id: patients.id, firstName: patients.firstName, lastName: patients.lastName } })
      .from(treatmentPlans)
      .innerJoin(patients, eq(patients.id, treatmentPlans.patientId))
      .where(
        and(
          eq(treatmentPlans.organizationId, actor.organizationId),
          isNull(treatmentPlans.deletedAt),
          isNull(patients.deletedAt),
          filter.status ? eq(treatmentPlans.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(treatmentPlans.updatedAt), desc(treatmentPlans.createdAt))
      .limit(ORG_PLAN_LIST_LIMIT);

    const result: OrganizationTreatmentPlanRow[] = [];
    for (const row of rows) {
      const detail = await loadDetail(tx, actor, row.plan);
      result.push({ plan: row.plan, patient: row.patient, itemPrices: detail.phases.flatMap((p) => p.items.map((i) => i.price)) });
    }
    return result;
  });
}

// --- Write: plan ---

export interface CreateTreatmentPlanInput {
  name: string;
}

/**
 * POST /patients/:id/treatment-plans — creates the plan and a default phase ("Phase
 * 1") in the same transaction, so the builder is never left with nowhere to drop an
 * item. See docs/specs/treatment-planning.md's "Building a plan" section.
 */
export async function createTreatmentPlan(actor: RequestActor, patientId: string, input: CreateTreatmentPlanInput) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);

    const [plan] = await tx
      .insert(treatmentPlans)
      .values({
        organizationId: actor.organizationId,
        patientId,
        name: input.name,
        status: "draft",
        createdBy: actor.userId,
      })
      .returning();

    await tx.insert(treatmentPlanPhases).values({
      organizationId: actor.organizationId,
      treatmentPlanId: plan.id,
      name: "Phase 1",
      sequence: 0,
      createdBy: actor.userId,
    });

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan",
      entityId: plan.id,
      action: "create",
      after: plan,
    });

    return loadDetail(tx, actor, plan);
  });
}

export interface UpdateTreatmentPlanInput {
  name?: string;
  to_status?: "declined";
}

/**
 * PATCH /treatment-plans/:id — the same double-duty convention as PATCH
 * /procedures/:id in chart.ts: `to_status` is a lifecycle transition (only
 * `declined` reaches here — `present`/`accept` are dedicated endpoints because each
 * carries side effects this plain patch doesn't), anything else is a content edit
 * (currently just `name`).
 */
export async function updateTreatmentPlan(actor: RequestActor, id: string, input: UpdateTreatmentPlanInput) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requirePlan(tx, actor, id);

    if (input.to_status) {
      assertLegalTransition(before.status, input.to_status);
      const [after] = await tx
        .update(treatmentPlans)
        .set({ status: input.to_status, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(treatmentPlans.id, id))
        .returning();

      await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
        entityType: "treatment_plan",
        entityId: id,
        action: "update",
        before,
        after,
      });
      return after;
    }

    assertEditable(before);
    const patch: Partial<typeof treatmentPlans.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;

    const [after] = await tx.update(treatmentPlans).set(patch).where(eq(treatmentPlans.id, id)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan",
      entityId: id,
      action: "update",
      before,
      after,
    });
    return after;
  });
}

/** POST /treatment-plans/:id/present — requires at least one item; stamps presented_at. */
export async function presentTreatmentPlan(actor: RequestActor, id: string) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requirePlan(tx, actor, id);
    assertLegalTransition(before.status, "presented");

    const items = await tx
      .select({ id: treatmentPlanItems.id })
      .from(treatmentPlanItems)
      .innerJoin(treatmentPlanPhases, eq(treatmentPlanItems.treatmentPlanPhaseId, treatmentPlanPhases.id))
      .where(and(eq(treatmentPlanPhases.treatmentPlanId, id), isNull(treatmentPlanItems.deletedAt)));
    if (items.length === 0) throw new TreatmentPlanEmptyError();

    const [after] = await tx
      .update(treatmentPlans)
      .set({ status: "presented", presentedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(treatmentPlans.id, id))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan",
      entityId: id,
      action: "update",
      before,
      after,
    });
    return after;
  });
}

export interface AcceptTreatmentPlanInput {
  signature_image?: string | null;
}

/**
 * POST /treatment-plans/:id/accept — the pricing-snapshot moment, per
 * docs/specs/treatment-planning.md. Atomic: every already-linked item's
 * charted_procedure must currently be `planned` and priceable, or the whole accept
 * rolls back (an item could have drifted off `planned` since being added — editing
 * stays open through `presented`). Every still-deferred item (nothing charted yet —
 * see "Adding a treatment without charting first") gets **promoted** here: a real
 * charted_procedure is created, already `accepted` and priced, and the item is
 * re-pointed at it — this is the moment ADR-0002's single-source-of-truth invariant
 * starts applying to it. `signature_image`, if sent, is stored as-is in
 * `signature_image_key` — informal consent capture, not a real object-storage key;
 * see the spec's "Signature capture" section for why.
 */
export async function acceptTreatmentPlan(actor: RequestActor, id: string, input: AcceptTreatmentPlanInput = {}) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requirePlan(tx, actor, id);
    assertLegalTransition(before.status, "accepted");

    const items = await tx
      .select({ item: treatmentPlanItems, procedure: chartedProcedures })
      .from(treatmentPlanItems)
      .innerJoin(treatmentPlanPhases, eq(treatmentPlanItems.treatmentPlanPhaseId, treatmentPlanPhases.id))
      .leftJoin(chartedProcedures, eq(treatmentPlanItems.chartedProcedureId, chartedProcedures.id))
      .where(and(eq(treatmentPlanPhases.treatmentPlanId, id), isNull(treatmentPlanItems.deletedAt)));
    if (items.length === 0) throw new TreatmentPlanEmptyError();

    for (const { item, procedure } of items) {
      if (procedure) {
        if (procedure.status !== "planned") throw new TreatmentPlanItemNotPlannedError();

        const priced = await resolvePrice(tx, actor, { procedure_code_id: procedure.procedureCodeId });

        const [afterProcedure] = await tx
          .update(chartedProcedures)
          .set({
            status: "accepted",
            price: priced.price,
            feeScheduleId: priced.fee_schedule_id,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })
          .where(eq(chartedProcedures.id, procedure.id))
          .returning();

        await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
          entityType: "charted_procedure",
          entityId: procedure.id,
          action: "update",
          before: procedure,
          after: afterProcedure,
        });
      } else {
        const procedureCodeId = item.procedureCodeId as string; // CHECK constraint guarantees this
        const priced = await resolvePrice(tx, actor, { procedure_code_id: procedureCodeId });
        const providerId = await defaultProviderId(tx, actor);

        const [newProcedure] = await tx
          .insert(chartedProcedures)
          .values({
            organizationId: actor.organizationId,
            patientId: before.patientId,
            procedureCodeId,
            tooth: item.tooth,
            surfaces: item.surfaces,
            quadrant: item.quadrant,
            arch: item.arch,
            status: "accepted",
            providerId,
            price: priced.price,
            feeScheduleId: priced.fee_schedule_id,
            createdBy: actor.userId,
          })
          .returning();

        await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
          entityType: "charted_procedure",
          entityId: newProcedure.id,
          action: "create",
          after: newProcedure,
        });

        const [afterItem] = await tx
          .update(treatmentPlanItems)
          .set({
            chartedProcedureId: newProcedure.id,
            procedureCodeId: null,
            tooth: null,
            surfaces: null,
            quadrant: null,
            arch: null,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })
          .where(eq(treatmentPlanItems.id, item.id))
          .returning();

        await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
          entityType: "treatment_plan_item",
          entityId: item.id,
          action: "update",
          before: item,
          after: afterItem,
        });
      }
    }

    const [after] = await tx
      .update(treatmentPlans)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        signatureImageKey: input.signature_image ?? null,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(treatmentPlans.id, id))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan",
      entityId: id,
      action: "update",
      before,
      after,
    });
    return after;
  });
}

// --- Write: phases ---

export interface CreatePhaseInput {
  name: string;
  note?: string | null;
}

export async function createPhase(actor: RequestActor, planId: string, input: CreatePhaseInput) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const plan = await requirePlan(tx, actor, planId);
    assertEditable(plan);

    const siblings = await tx
      .select({ sequence: treatmentPlanPhases.sequence })
      .from(treatmentPlanPhases)
      .where(and(eq(treatmentPlanPhases.treatmentPlanId, planId), isNull(treatmentPlanPhases.deletedAt)));
    const nextSequence = siblings.length ? Math.max(...siblings.map((s) => s.sequence)) + 1 : 0;

    const [phase] = await tx
      .insert(treatmentPlanPhases)
      .values({
        organizationId: actor.organizationId,
        treatmentPlanId: planId,
        name: input.name,
        sequence: nextSequence,
        note: input.note ?? null,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan_phase",
      entityId: phase.id,
      action: "create",
      after: phase,
    });
    return phase;
  });
}

/**
 * PATCH /phases/:id { sequence } — not in the original api-surface.md list; added for
 * drag-to-reorder (docs/specs/treatment-planning.md). List-reorder-by-target-index:
 * pull every sibling phase, move the target to the requested position, renumber
 * everyone 0..n-1.
 */
export async function reorderPhase(actor: RequestActor, phaseId: string, sequence: number) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const target = await requirePhase(tx, actor, phaseId);
    const plan = await requirePlan(tx, actor, target.treatmentPlanId);
    assertEditable(plan);

    const before = await tx
      .select()
      .from(treatmentPlanPhases)
      .where(and(eq(treatmentPlanPhases.treatmentPlanId, target.treatmentPlanId), isNull(treatmentPlanPhases.deletedAt)))
      .orderBy(asc(treatmentPlanPhases.sequence));

    const ordered = before.filter((p) => p.id !== phaseId);
    const clamped = Math.max(0, Math.min(sequence, ordered.length));
    ordered.splice(clamped, 0, target);

    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sequence !== i) {
        await tx
          .update(treatmentPlanPhases)
          .set({ sequence: i, updatedBy: actor.userId, updatedAt: new Date() })
          .where(eq(treatmentPlanPhases.id, ordered[i].id));
      }
    }

    const after = await tx
      .select()
      .from(treatmentPlanPhases)
      .where(and(eq(treatmentPlanPhases.treatmentPlanId, target.treatmentPlanId), isNull(treatmentPlanPhases.deletedAt)))
      .orderBy(asc(treatmentPlanPhases.sequence));

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan_phase",
      entityId: phaseId,
      action: "update",
      before,
      after,
    });

    return after.find((p) => p.id === phaseId)!;
  });
}

// --- Write: items ---

export interface NewProcedureInput extends ScopeInput {
  procedure_code_id: string;
  // true: chart it now (a real charted_procedure is created immediately, kept in
  // sync with the Odontogram from the start — requires odontogram write, not just
  // treatment_plans write). false: defer — the item stays plan-only until this
  // plan is accepted, at which point it's promoted (see acceptTreatmentPlan). See
  // docs/specs/treatment-planning.md's "Adding a treatment without charting first".
  chart_now: boolean;
}

export interface AddItemInput {
  charted_procedure_id?: string;
  new_procedure?: NewProcedureInput;
}

/**
 * POST /phases/:id/items — three ways an item can be added, per
 * docs/specs/treatment-planning.md:
 * 1. `charted_procedure_id` — reference an existing, still-`planned` procedure
 *    (the original "from chart" path; requireAddableProcedure above).
 * 2. `new_procedure` with `chart_now: true` — pick any procedure code, chart it
 *    immediately (same validation chart.ts's own createProcedure runs, done inline
 *    here so it lands in this same transaction), then link to it.
 * 3. `new_procedure` with `chart_now: false` — the same picker, but nothing is
 *    charted: the code/tooth/surfaces/scope are copied onto the item itself and
 *    charting is deferred until accept. Lets a plan get built (and even accepted-
 *    -intent discussed with the patient) without an Odontogram entry existing yet —
 *    not every patient walks in needing a full chart before a quick treatment plan.
 */
export async function addItemToPhase(actor: RequestActor, phaseId: string, input: AddItemInput) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const phase = await requirePhase(tx, actor, phaseId);
    const plan = await requirePlan(tx, actor, phase.treatmentPlanId);
    assertEditable(plan);

    const siblings = await tx
      .select({ sequence: treatmentPlanItems.sequence })
      .from(treatmentPlanItems)
      .where(and(eq(treatmentPlanItems.treatmentPlanPhaseId, phaseId), isNull(treatmentPlanItems.deletedAt)));
    const nextSequence = siblings.length ? Math.max(...siblings.map((s) => s.sequence)) + 1 : 0;

    let values: typeof treatmentPlanItems.$inferInsert;

    if (input.charted_procedure_id) {
      await requireAddableProcedure(tx, actor, plan.patientId, input.charted_procedure_id);

      // A still-`planned` procedure doesn't stop itself being added twice to the
      // same plan (its own status only flips at accept) — check for that directly,
      // same error as any other "not available to add" case.
      const [alreadyOnPlan] = await tx
        .select({ id: treatmentPlanItems.id })
        .from(treatmentPlanItems)
        .innerJoin(treatmentPlanPhases, eq(treatmentPlanItems.treatmentPlanPhaseId, treatmentPlanPhases.id))
        .where(
          and(
            eq(treatmentPlanPhases.treatmentPlanId, phase.treatmentPlanId),
            eq(treatmentPlanItems.chartedProcedureId, input.charted_procedure_id),
            isNull(treatmentPlanItems.deletedAt),
          ),
        )
        .limit(1);
      if (alreadyOnPlan) throw new TreatmentPlanItemNotPlannedError();

      values = {
        organizationId: actor.organizationId,
        treatmentPlanPhaseId: phaseId,
        chartedProcedureId: input.charted_procedure_id,
        sequence: nextSequence,
        createdBy: actor.userId,
      };
    } else if (input.new_procedure?.chart_now) {
      assertCan(actor.role, "odontogram", "write");
      const np = input.new_procedure;
      const code = await requireProcedureCode(tx, actor, np.procedure_code_id);
      assertScopeMatches(code, np);
      assertToothAndSurfacesValid(np.tooth, np.surfaces);
      const providerId = await defaultProviderId(tx, actor);

      const [procedure] = await tx
        .insert(chartedProcedures)
        .values({
          organizationId: actor.organizationId,
          patientId: plan.patientId,
          procedureCodeId: code.id,
          tooth: np.tooth ?? null,
          surfaces: np.surfaces ?? null,
          quadrant: np.quadrant ?? null,
          arch: np.arch ?? null,
          status: "planned",
          providerId,
          price: null,
          feeScheduleId: null,
          createdBy: actor.userId,
        })
        .returning();

      await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
        entityType: "charted_procedure",
        entityId: procedure.id,
        action: "create",
        after: procedure,
      });

      values = {
        organizationId: actor.organizationId,
        treatmentPlanPhaseId: phaseId,
        chartedProcedureId: procedure.id,
        sequence: nextSequence,
        createdBy: actor.userId,
      };
    } else if (input.new_procedure) {
      const np = input.new_procedure;
      const code = await requireProcedureCode(tx, actor, np.procedure_code_id);
      assertScopeMatches(code, np);
      assertToothAndSurfacesValid(np.tooth, np.surfaces);

      values = {
        organizationId: actor.organizationId,
        treatmentPlanPhaseId: phaseId,
        procedureCodeId: code.id,
        tooth: np.tooth ?? null,
        surfaces: np.surfaces ?? null,
        quadrant: np.quadrant ?? null,
        arch: np.arch ?? null,
        sequence: nextSequence,
        createdBy: actor.userId,
      };
    } else {
      throw new TreatmentPlanItemNotPlannedError();
    }

    const [item] = await tx.insert(treatmentPlanItems).values(values).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan_item",
      entityId: item.id,
      action: "create",
      after: item,
    });
    return item;
  });
}

/** DELETE /items/:id */
export async function removeItem(actor: RequestActor, itemId: string) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const item = await requireItem(tx, actor, itemId);
    const phase = await requirePhase(tx, actor, item.treatmentPlanPhaseId);
    const plan = await requirePlan(tx, actor, phase.treatmentPlanId);
    assertEditable(plan);

    await tx.delete(treatmentPlanItems).where(eq(treatmentPlanItems.id, itemId));

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan_item",
      entityId: itemId,
      action: "delete",
      before: item,
    });
  });
}

/** PATCH /items/:id { sequence } — reorders within the item's own phase, same
 * list-reorder-by-target-index mechanism as reorderPhase above. */
export async function reorderItem(actor: RequestActor, itemId: string, sequence: number) {
  assertCan(actor.role, "treatment_plans", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const target = await requireItem(tx, actor, itemId);
    const phase = await requirePhase(tx, actor, target.treatmentPlanPhaseId);
    const plan = await requirePlan(tx, actor, phase.treatmentPlanId);
    assertEditable(plan);

    const before = await tx
      .select()
      .from(treatmentPlanItems)
      .where(and(eq(treatmentPlanItems.treatmentPlanPhaseId, target.treatmentPlanPhaseId), isNull(treatmentPlanItems.deletedAt)))
      .orderBy(asc(treatmentPlanItems.sequence));

    const ordered = before.filter((i) => i.id !== itemId);
    const clamped = Math.max(0, Math.min(sequence, ordered.length));
    ordered.splice(clamped, 0, target);

    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sequence !== i) {
        await tx
          .update(treatmentPlanItems)
          .set({ sequence: i, updatedBy: actor.userId, updatedAt: new Date() })
          .where(eq(treatmentPlanItems.id, ordered[i].id));
      }
    }

    const after = await tx
      .select()
      .from(treatmentPlanItems)
      .where(and(eq(treatmentPlanItems.treatmentPlanPhaseId, target.treatmentPlanPhaseId), isNull(treatmentPlanItems.deletedAt)))
      .orderBy(asc(treatmentPlanItems.sequence));

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "treatment_plan_item",
      entityId: itemId,
      action: "update",
      before,
      after,
    });

    return after.find((i) => i.id === itemId)!;
  });
}
