import { eq, and, isNull, gt, gte, lte, or, ilike, sql } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import { procedureCodes, feeSchedules, feeScheduleItems } from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { writeAudit } from "./audit";
import type { RequestActor } from "@/server/lib/request-auth";

export class ProcedureCodeNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Procedure code not found.");
    this.name = "ProcedureCodeNotFoundError";
  }
}

export class FeeScheduleNotFoundError extends Error {
  constructor() {
    super("Fee schedule not found.");
    this.name = "FeeScheduleNotFoundError";
  }
}

// 422 — well-formed request, just nothing priced yet for this combination. Per
// docs/specs/validation-and-errors.md's FEE_SCHEDULE_NO_PRICE code.
export class FeeScheduleNoPriceError extends Error {
  constructor() {
    super("No price is set for this procedure yet.");
    this.name = "FeeScheduleNoPriceError";
  }
}

// 409 per docs/specs/validation-and-errors.md's DUPLICATE_PROCEDURE_CODE code.
export class DuplicateProcedureCodeError extends Error {
  constructor(code: string) {
    super(`Procedure code "${code}" already exists in this catalog.`);
    this.name = "DuplicateProcedureCodeError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}

type ProcedureCategory = (typeof procedureCodes.$inferSelect)["category"];
type ProcedureScope = (typeof procedureCodes.$inferSelect)["appliesTo"];
type TaxClass = (typeof procedureCodes.$inferSelect)["taxClass"];

export interface CreateProcedureCodeInput {
  code: string;
  short_name: string;
  description?: string | null;
  category: ProcedureCategory;
  applies_to: ProcedureScope;
  surfaces_required?: boolean;
  tax_class?: TaxClass;
  cdt_equivalent?: string | null;
}

export type UpdateProcedureCodeInput = Partial<CreateProcedureCodeInput> & { is_active?: boolean };

export interface ListProcedureCodesInput {
  category?: ProcedureCategory;
  q?: string;
  active?: boolean;
  cursor?: string;
  limit?: number;
}

/**
 * procedure_codes carries a second RLS policy (see rls.sql) that makes the shared
 * starter template (organization_id IS NULL) visible to every tenant session — unlike
 * every other table, a bare RLS-scoped query here is NOT automatically limited to "this
 * org's rows." Every function below except importStarterTemplate must filter
 * organization_id = actor.organizationId explicitly, or it will silently mix the shared
 * template into what's supposed to be one clinic's own catalog.
 */
export async function listProcedureCodes(actor: RequestActor, input: ListProcedureCodesInput = {}) {
  assertCan(actor.role, "procedure_codes", "read");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  return dbForRequest(actor.organizationId, async (tx) => {
    const conditions = [eq(procedureCodes.organizationId, actor.organizationId), isNull(procedureCodes.deletedAt)];
    if (input.cursor) conditions.push(gt(procedureCodes.code, input.cursor));
    if (input.category) conditions.push(eq(procedureCodes.category, input.category));
    if (input.active !== undefined) conditions.push(eq(procedureCodes.isActive, input.active));
    if (input.q) {
      const term = `%${input.q}%`;
      const nameOrCode = or(ilike(procedureCodes.shortName, term), ilike(procedureCodes.code, term));
      if (nameOrCode) conditions.push(nameOrCode);
    }

    const rows = await tx
      .select()
      .from(procedureCodes)
      .where(and(...conditions))
      .orderBy(procedureCodes.code)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].code : null;

    return { data, nextCursor };
  });
}

export async function createProcedureCode(actor: RequestActor, input: CreateProcedureCodeInput) {
  assertCan(actor.role, "procedure_codes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    let created;
    try {
      [created] = await tx
        .insert(procedureCodes)
        .values({
          organizationId: actor.organizationId,
          code: input.code,
          shortName: input.short_name,
          description: input.description ?? null,
          category: input.category,
          appliesTo: input.applies_to,
          surfacesRequired: input.surfaces_required ?? false,
          taxClass: input.tax_class ?? "exempt_healthcare",
          cdtEquivalent: input.cdt_equivalent ?? null,
          createdBy: actor.userId,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateProcedureCodeError(input.code);
      throw err;
    }

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "procedure_code",
      entityId: created.id,
      action: "create",
      after: created,
    });

    return created;
  });
}

export async function updateProcedureCode(actor: RequestActor, id: string, input: UpdateProcedureCodeInput) {
  assertCan(actor.role, "procedure_codes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(procedureCodes)
      .where(
        and(
          eq(procedureCodes.id, id),
          eq(procedureCodes.organizationId, actor.organizationId),
          isNull(procedureCodes.deletedAt),
        ),
      )
      .limit(1);
    if (!before) throw new ProcedureCodeNotFoundError();

    const patch: Partial<typeof procedureCodes.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.code !== undefined) patch.code = input.code;
    if (input.short_name !== undefined) patch.shortName = input.short_name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.category !== undefined) patch.category = input.category;
    if (input.applies_to !== undefined) patch.appliesTo = input.applies_to;
    if (input.surfaces_required !== undefined) patch.surfacesRequired = input.surfaces_required;
    if (input.tax_class !== undefined) patch.taxClass = input.tax_class;
    if (input.cdt_equivalent !== undefined) patch.cdtEquivalent = input.cdt_equivalent;
    if (input.is_active !== undefined) patch.isActive = input.is_active;

    let after;
    try {
      [after] = await tx.update(procedureCodes).set(patch).where(eq(procedureCodes.id, id)).returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateProcedureCodeError(input.code ?? before.code);
      throw err;
    }

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "procedure_code",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/**
 * Copies the shared starter template (organization_id IS NULL) into this org's own
 * catalog — the onboarding convenience described in docs/specs/pilot-foundations.md §1.
 * Reads the template via the permissive SELECT policy on procedure_codes (see rls.sql),
 * still through dbForRequest — never adminDb, per CLAUDE.md's tenancy rule. Skips codes
 * already present in the org so a repeat import is a safe no-op, not a duplicate error.
 */
export async function importStarterTemplate(actor: RequestActor) {
  assertCan(actor.role, "procedure_codes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const template = await tx.select().from(procedureCodes).where(isNull(procedureCodes.organizationId));

    const existing = await tx
      .select({ code: procedureCodes.code })
      .from(procedureCodes)
      .where(eq(procedureCodes.organizationId, actor.organizationId));
    const existingCodes = new Set(existing.map((r) => r.code));

    const toInsert = template
      .filter((t) => !existingCodes.has(t.code))
      .map((t) => ({
        organizationId: actor.organizationId,
        code: t.code,
        shortName: t.shortName,
        description: t.description,
        category: t.category,
        appliesTo: t.appliesTo,
        surfacesRequired: t.surfacesRequired,
        taxClass: t.taxClass,
        cdtEquivalent: t.cdtEquivalent,
        createdBy: actor.userId,
      }));

    if (toInsert.length === 0) return [];

    const inserted = await tx.insert(procedureCodes).values(toInsert).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "procedure_code",
      entityId: null,
      action: "create",
      after: { imported_count: inserted.length, codes: inserted.map((r) => r.code) },
    });

    return inserted;
  });
}

export interface CreateFeeScheduleInput {
  name: string;
  location_id?: string | null;
  effective_from: string;
  effective_to?: string | null;
  is_default?: boolean;
}

export async function listFeeSchedules(actor: RequestActor) {
  assertCan(actor.role, "fee_schedules", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    return tx.select().from(feeSchedules).where(isNull(feeSchedules.deletedAt));
  });
}

export async function createFeeSchedule(actor: RequestActor, input: CreateFeeScheduleInput) {
  assertCan(actor.role, "fee_schedules", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [created] = await tx
      .insert(feeSchedules)
      .values({
        organizationId: actor.organizationId,
        name: input.name,
        locationId: input.location_id ?? null,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to ?? null,
        isDefault: input.is_default ?? false,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "fee_schedule",
      entityId: created.id,
      action: "create",
      after: created,
    });

    return created;
  });
}

async function requireFeeSchedule(tx: Parameters<Parameters<typeof dbForRequest>[1]>[0], actor: RequestActor, feeScheduleId: string) {
  const [schedule] = await tx
    .select()
    .from(feeSchedules)
    .where(
      and(
        eq(feeSchedules.id, feeScheduleId),
        eq(feeSchedules.organizationId, actor.organizationId),
        isNull(feeSchedules.deletedAt),
      ),
    )
    .limit(1);
  if (!schedule) throw new FeeScheduleNotFoundError();
  return schedule;
}

export async function listFeeScheduleItems(actor: RequestActor, feeScheduleId: string) {
  assertCan(actor.role, "fee_schedules", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requireFeeSchedule(tx, actor, feeScheduleId);
    return tx.select().from(feeScheduleItems).where(eq(feeScheduleItems.feeScheduleId, feeScheduleId));
  });
}

export interface FeeScheduleItemInput {
  procedure_code_id: string;
  price: string;
}

/**
 * Bulk upsert, not replace — docs/specs/api-surface.md calls PUT here deliberately
 * atomic, but "bulk upsert" means items missing from the payload are left alone, not
 * deleted. The editor saves whichever rows the clinic actually touched.
 */
export async function upsertFeeScheduleItems(actor: RequestActor, feeScheduleId: string, items: FeeScheduleItemInput[]) {
  assertCan(actor.role, "fee_schedules", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requireFeeSchedule(tx, actor, feeScheduleId);

    const before = await tx.select().from(feeScheduleItems).where(eq(feeScheduleItems.feeScheduleId, feeScheduleId));

    const after = await tx
      .insert(feeScheduleItems)
      .values(
        items.map((item) => ({
          organizationId: actor.organizationId,
          feeScheduleId,
          procedureCodeId: item.procedure_code_id,
          price: item.price,
          createdBy: actor.userId,
        })),
      )
      .onConflictDoUpdate({
        target: [feeScheduleItems.feeScheduleId, feeScheduleItems.procedureCodeId],
        set: { price: sql`excluded.price`, updatedBy: actor.userId, updatedAt: new Date() },
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "fee_schedule_items",
      entityId: feeScheduleId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

export interface GetPricingInput {
  procedure_code_id: string;
  location_id?: string;
  on_date?: string;
}

/**
 * Resolves the effective price for a procedure on a given date/location. Candidate
 * schedules are those currently in effect (effective_from <= on_date <= effective_to,
 * or effective_to null = open-ended); a location-specific schedule wins over an
 * org-wide one when both exist, and within a tier the default schedule wins, else the
 * most recently effective one. See docs/specs/api-surface.md's GET /pricing.
 */
export async function getPricing(actor: RequestActor, input: GetPricingInput) {
  assertCan(actor.role, "fee_schedules", "read");
  const onDate = input.on_date ?? new Date().toISOString().slice(0, 10);

  return dbForRequest(actor.organizationId, async (tx) => {
    const effectiveToCondition = or(isNull(feeSchedules.effectiveTo), gte(feeSchedules.effectiveTo, onDate));

    const candidates = await tx
      .select()
      .from(feeSchedules)
      .where(
        and(
          eq(feeSchedules.organizationId, actor.organizationId),
          isNull(feeSchedules.deletedAt),
          lte(feeSchedules.effectiveFrom, onDate),
          ...(effectiveToCondition ? [effectiveToCondition] : []),
        ),
      );

    const locationMatch = input.location_id ? candidates.filter((c) => c.locationId === input.location_id) : [];
    const orgWide = candidates.filter((c) => c.locationId === null);
    const pool = locationMatch.length > 0 ? locationMatch : orgWide;
    const chosen =
      pool.find((c) => c.isDefault) ??
      [...pool].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

    if (!chosen) throw new FeeScheduleNoPriceError();

    const [item] = await tx
      .select()
      .from(feeScheduleItems)
      .where(
        and(eq(feeScheduleItems.feeScheduleId, chosen.id), eq(feeScheduleItems.procedureCodeId, input.procedure_code_id)),
      )
      .limit(1);
    if (!item) throw new FeeScheduleNoPriceError();

    return { procedure_code_id: input.procedure_code_id, fee_schedule_id: chosen.id, price: item.price };
  });
}
