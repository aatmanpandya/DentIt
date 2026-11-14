import { sql, eq, and, isNull, desc, lt, inArray, asc } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import { perioExams, perioExamEvents, perioToothRecords, perioSiteMeasurements, patients, users } from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { hasFurcation, isPrimaryTooth, isValidFdiTooth } from "@/server/lib/tooth-notation";
// Pure, DOM-free arch/socket geometry — no React dependency (see its own header comment).
// Perio reuses it rather than re-deriving which FDI occupies which socket; the Odontogram
// handoff (docs/specs/odontogram.md) already designates getToothState as the shared read
// contract these two features both call.
import { SOCKETS, resolveSocketTooth, defaultDentitionView } from "@/components/chart/tooth-grid";
import { getToothState, InvalidToothError } from "./chart";
import { writeAudit } from "./audit";
import { PatientNotFoundError } from "./patients";
import type { RequestActor } from "@/server/lib/request-auth";

export { PatientNotFoundError, InvalidToothError };

export class PerioExamNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Perio exam not found.");
    this.name = "PerioExamNotFoundError";
  }
}

// 422 — PERIO_EXAM_COMPLETED, reserved in docs/specs/validation-and-errors.md. The perio
// equivalent of NOTE_ALREADY_SIGNED.
export class PerioExamCompletedError extends Error {
  constructor() {
    super("This exam is complete. Reopen it to make changes.");
    this.name = "PerioExamCompletedError";
  }
}

// 422 — generic VALIDATION_FAILED. Furcation is Glickman-scored only on multi-rooted
// teeth (molars + 14/24) — see docs/specs/pilot-foundations.md §2.
export class InvalidFurcationError extends Error {
  constructor(tooth: string) {
    super(`Tooth ${tooth} isn't multi-rooted — furcation doesn't apply.`);
    this.name = "InvalidFurcationError";
  }
}

// 422 — generic VALIDATION_FAILED. `provider_id` is user-pickable (docs/specs/perio.md's
// "pickable at creation, decoupled from write-RBAC"), so unlike the actor-defaulted case it
// needs real validation: must be an active user of this org in an eligible clinical role.
export class InvalidProviderError extends Error {
  constructor() {
    super("The selected provider isn't an eligible clinical staff member in this organization.");
    this.name = "InvalidProviderError";
  }
}

// Owner/Provider/Hygienist/Assistant — broader than perio write-RBAC on purpose (an
// assistant transcribes for a hygienist who did the actual probing), per
// docs/specs/perio.md's "RBAC" section. Deliberately NOT locations.ts's listProviders(),
// which inner-joins provider_profiles (a scheduling concept — color, operatory) that
// assistants don't have rows for; reusing it would silently drop the one role this picker
// exists for.
const ELIGIBLE_PROVIDER_ROLES = ["owner", "provider", "hygienist", "assistant"] as const;

type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

async function requirePatient(tx: Tx, actor: RequestActor, patientId: string) {
  const [row] = await tx
    .select({ id: patients.id, dateOfBirth: patients.dateOfBirth })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, actor.organizationId), isNull(patients.deletedAt)))
    .limit(1);
  if (!row) throw new PatientNotFoundError();
  return row;
}

async function requireExam(tx: Tx, actor: RequestActor, examId: string) {
  const [row] = await tx
    .select()
    .from(perioExams)
    .where(and(eq(perioExams.id, examId), eq(perioExams.organizationId, actor.organizationId), isNull(perioExams.deletedAt)))
    .limit(1);
  if (!row) throw new PerioExamNotFoundError();
  return row;
}

// --- Read ---

/**
 * The perio provider-picker's data source (docs/specs/perio.md, "provider_id... pickable at
 * creation") — active org users in an eligible clinical role, not locations.ts's
 * listProviders() (a scheduling-scoped list assistants aren't part of).
 */
export async function listEligiblePerioProviders(actor: RequestActor) {
  assertCan(actor.role, "perio", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    return tx
      .select({ id: users.id, fullName: users.fullName, role: users.role })
      .from(users)
      .where(and(eq(users.organizationId, actor.organizationId), eq(users.isActive, true), inArray(users.role, [...ELIGIBLE_PROVIDER_ROLES])))
      .orderBy(asc(users.fullName));
  });
}

export async function listPatientPerioExams(actor: RequestActor, patientId: string) {
  assertCan(actor.role, "perio", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);

    return tx
      .select()
      .from(perioExams)
      .where(and(eq(perioExams.patientId, patientId), isNull(perioExams.deletedAt)))
      .orderBy(desc(perioExams.examDate));
  });
}

export interface PerioToothDetail {
  record: typeof perioToothRecords.$inferSelect;
  sites: (typeof perioSiteMeasurements.$inferSelect)[];
}

/** GET /perio-exams/:id — full exam, all teeth and sites, per docs/specs/api-surface.md. */
export async function getPerioExam(actor: RequestActor, examId: string) {
  assertCan(actor.role, "perio", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const exam = await requireExam(tx, actor, examId);

    const records = await tx
      .select()
      .from(perioToothRecords)
      .where(and(eq(perioToothRecords.examId, examId), isNull(perioToothRecords.deletedAt)));

    const sites = await tx
      .select()
      .from(perioSiteMeasurements)
      .where(and(eq(perioSiteMeasurements.examId, examId), isNull(perioSiteMeasurements.deletedAt)));

    const sitesByTooth = new Map<string, (typeof perioSiteMeasurements.$inferSelect)[]>();
    for (const site of sites) {
      const list = sitesByTooth.get(site.tooth) ?? [];
      list.push(site);
      sitesByTooth.set(site.tooth, list);
    }

    const teeth: PerioToothDetail[] = records.map((record) => ({ record, sites: sitesByTooth.get(record.tooth) ?? [] }));

    return { exam, teeth };
  });
}

// --- Write ---

export interface CreatePerioExamInput {
  exam_date: string;
  provider_id?: string | null;
  notes?: string | null;
}

/**
 * POST /patients/:id/perio-exams — creates the exam shell. Per docs/specs/perio.md, the
 * shell starts empty (no pre-filled healthy measurement values), but a `perio_tooth_records`
 * row is seeded for every socket that actually has a tooth in it right now — resolved the
 * same way the Odontogram resolves it (`resolveSocketTooth`, in the patient's default view by age) —
 * with `is_skipped` auto-set for a missing tooth or a primary tooth (AAPD guidance), per the
 * Odontogram's "Handoff to Perio". An empty socket (no tooth present at all) gets no row —
 * there's nothing to probe or skip.
 */
export async function createPerioExam(actor: RequestActor, patientId: string, input: CreatePerioExamInput) {
  assertCan(actor.role, "perio", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const patient = await requirePatient(tx, actor, patientId);
    // Same default as the chart: an adult is examined in adult dentition (entry 36).
    const view = defaultDentitionView(patient.dateOfBirth, input.exam_date);

    if (input.provider_id) {
      const [provider] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.provider_id),
            eq(users.organizationId, actor.organizationId),
            eq(users.isActive, true),
            inArray(users.role, [...ELIGIBLE_PROVIDER_ROLES]),
          ),
        )
        .limit(1);
      if (!provider) throw new InvalidProviderError();
    }

    const [exam] = await tx
      .insert(perioExams)
      .values({
        organizationId: actor.organizationId,
        patientId,
        providerId: input.provider_id ?? actor.userId,
        examDate: input.exam_date,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    const fdisToCheck = new Set<string>();
    for (const socket of SOCKETS) {
      fdisToCheck.add(socket.permanentFdi);
      if (socket.primaryFdi) fdisToCheck.add(socket.primaryFdi);
    }
    const toothStateByFdi: Record<string, Awaited<ReturnType<typeof getToothState>>> = {};
    for (const fdi of fdisToCheck) {
      toothStateByFdi[fdi] = await getToothState(tx, patientId, fdi);
    }

    for (const socket of SOCKETS) {
      const tooth = resolveSocketTooth(socket, toothStateByFdi, view);
      if (!tooth) continue;

      const isSkipped = toothStateByFdi[tooth].isMissing || isPrimaryTooth(tooth);

      await tx.insert(perioToothRecords).values({
        organizationId: actor.organizationId,
        examId: exam.id,
        tooth,
        isSkipped,
        createdBy: actor.userId,
      });
    }

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "perio_exam",
      entityId: exam.id,
      action: "create",
      after: exam,
    });

    return exam;
  });
}

export interface UpdatePerioExamInput {
  notes?: string | null;
}

/** PATCH /perio-exams/:id — notes only. Not in the original api-surface.md list; added the
 * same way Clinical Notes' delete was, for a real need surfaced during grilling
 * (docs/specs/perio.md — the notes field lives inline below the periochart). */
export async function updatePerioExamNotes(actor: RequestActor, examId: string, input: UpdatePerioExamInput) {
  assertCan(actor.role, "perio", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireExam(tx, actor, examId);

    const [after] = await tx
      .update(perioExams)
      .set({ notes: input.notes ?? null, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(perioExams.id, examId))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "perio_exam",
      entityId: examId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

export interface PerioSiteInput {
  site: string;
  pocket_depth: number;
  gingival_margin?: number | null;
  bleeding_on_probing?: boolean;
  suppuration?: boolean;
  plaque?: boolean;
}

export interface UpsertPerioToothRecordInput {
  mobility?: number | null;
  furcation?: number | null;
  is_skipped?: boolean;
  sites: PerioSiteInput[];
  clear_sites?: string[];
  // "voice": the dictated phrase is already in the transcript with its own change list, so the
  // save isn't logged again. Anything else is a keyboard/click edit, logged as "typed".
  source?: "keyboard" | "voice";
}

/**
 * PUT /perio-exams/:id/teeth/:tooth — the load-bearing endpoint, per docs/specs/api-surface.md.
 * Genuinely partial: the skip-toggle interaction (docs/specs/perio.md) calls this with only
 * `is_skipped` set and an empty `sites` array, and must not clobber mobility/furcation/sites
 * already saved from an earlier call — so tooth-record fields merge against the existing row
 * rather than blind-overwriting. Sites, once sent, always arrive as a complete record per site
 * (the client accumulates a whole site's fields locally before it's ever included in a PUT), so
 * those upsert as a straight overwrite.
 */
export async function upsertPerioToothRecord(actor: RequestActor, examId: string, tooth: string, input: UpsertPerioToothRecordInput) {
  assertCan(actor.role, "perio", "write");

  if (!isValidFdiTooth(tooth)) throw new InvalidToothError(tooth);

  return dbForRequest(actor.organizationId, async (tx) => {
    const exam = await requireExam(tx, actor, examId);
    if (exam.completedAt) throw new PerioExamCompletedError();
    if (input.furcation != null && !hasFurcation(tooth)) throw new InvalidFurcationError(tooth);

    const [existing] = await tx
      .select()
      .from(perioToothRecords)
      .where(and(eq(perioToothRecords.examId, examId), eq(perioToothRecords.tooth, tooth)))
      .limit(1);
    if (!existing) throw new InvalidToothError(tooth);

    const sitesBefore = await tx
      .select()
      .from(perioSiteMeasurements)
      .where(and(eq(perioSiteMeasurements.examId, examId), eq(perioSiteMeasurements.tooth, tooth)));

    const patch = {
      mobility: input.mobility !== undefined ? input.mobility : existing.mobility,
      furcation: input.furcation !== undefined ? input.furcation : existing.furcation,
      isSkipped: input.is_skipped !== undefined ? input.is_skipped : existing.isSkipped,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    };

    const [record] = await tx.update(perioToothRecords).set(patch).where(eq(perioToothRecords.id, existing.id)).returning();

    if (input.clear_sites && input.clear_sites.length > 0) {
      await tx
        .delete(perioSiteMeasurements)
        .where(
          and(
            eq(perioSiteMeasurements.examId, examId),
            eq(perioSiteMeasurements.tooth, tooth),
            inArray(perioSiteMeasurements.site, input.clear_sites as (typeof perioSiteMeasurements.$inferSelect)["site"][]),
          ),
        );
    }

    if (input.sites.length > 0) {
      await tx
        .insert(perioSiteMeasurements)
        .values(
          input.sites.map((s) => ({
            organizationId: actor.organizationId,
            examId,
            tooth,
            site: s.site as (typeof perioSiteMeasurements.$inferInsert)["site"],
            pocketDepth: s.pocket_depth,
            gingivalMargin: s.gingival_margin ?? null,
            bleedingOnProbing: s.bleeding_on_probing ?? false,
            suppuration: s.suppuration ?? false,
            plaque: s.plaque ?? false,
            createdBy: actor.userId,
          })),
        )
        .onConflictDoUpdate({
          target: [perioSiteMeasurements.examId, perioSiteMeasurements.tooth, perioSiteMeasurements.site],
          set: {
            pocketDepth: sql`excluded.pocket_depth`,
            gingivalMargin: sql`excluded.gingival_margin`,
            bleedingOnProbing: sql`excluded.bleeding_on_probing`,
            suppuration: sql`excluded.suppuration`,
            plaque: sql`excluded.plaque`,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          },
        });
    }

    const sites = await tx
      .select()
      .from(perioSiteMeasurements)
      .where(and(eq(perioSiteMeasurements.examId, examId), eq(perioSiteMeasurements.tooth, tooth)));

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "perio_tooth_record",
      entityId: record.id,
      action: "update",
      before: existing,
      after: record,
    });

    // The exam's transcript (docs/specs/perio-approval.md): keyboard edits go in as "typed",
    // with exactly what changed. A retried save that changes nothing adds nothing.
    if (input.source !== "voice") {
      const changes = diffTooth(tooth, existing, record, sitesBefore, sites);
      if (changes.length > 0) {
        await tx.insert(perioExamEvents).values({ organizationId: actor.organizationId, examId, kind: "typed", changes, createdBy: actor.userId });
      }
    }

    return { record, sites };
  });
}


export interface PerioChange {
  tooth: string;
  site: string | null;
  field: string;
  from: number | boolean | null;
  to: number | boolean | null;
}

type SiteRow = typeof perioSiteMeasurements.$inferSelect;
type ToothRow = typeof perioToothRecords.$inferSelect;

/** What one tooth save changed: tooth-level fields, then each site's fields. */
export function diffTooth(tooth: string, before: ToothRow, after: ToothRow, sitesBefore: SiteRow[], sitesAfter: SiteRow[]): PerioChange[] {
  const out: PerioChange[] = [];
  for (const [field, key] of [["mobility", "mobility"], ["furcation", "furcation"], ["skipped", "isSkipped"]] as const) {
    if (before[key] !== after[key]) out.push({ tooth, site: null, field, from: before[key], to: after[key] });
  }
  const FIELDS = [["pocket_depth", "pocketDepth"], ["recession", "gingivalMargin"], ["bleeding", "bleedingOnProbing"], ["suppuration", "suppuration"], ["plaque", "plaque"]] as const;
  const sites = new Set([...sitesBefore, ...sitesAfter].map((s) => s.site));
  for (const site of sites) {
    const b = sitesBefore.find((s) => s.site === site);
    const a = sitesAfter.find((s) => s.site === site);
    for (const [field, key] of FIELDS) {
      // A site that doesn't exist has no measurements: numbers read null, flags read false.
      const isFlag = field === "bleeding" || field === "suppuration" || field === "plaque";
      const from = b ? b[key] : isFlag ? false : null;
      const to = a ? a[key] : isFlag ? false : null;
      if (from !== to) out.push({ tooth, site, field, from, to });
    }
  }
  return out;
}

export class PerioApprovalReasonRequiredError extends Error {
  constructor() {
    super("Say why the approved exam is being reopened.");
    this.name = "PerioApprovalReasonRequiredError";
  }
}

export class PerioExamNotApprovedError extends Error {
  constructor() {
    super("This exam isn't approved, so there's nothing to reopen.");
    this.name = "PerioExamNotApprovedError";
  }
}

export interface RecordPhraseInput {
  heard: string[];
  used: string | null;
  outcome: "written" | "refused" | "waiting" | "undo";
  note: string | null;
  changes: PerioChange[];
}

/** POST /perio-exams/:id/events — one dictated phrase, in the exam's transcript. */
export async function recordPerioPhrase(actor: RequestActor, examId: string, input: RecordPhraseInput) {
  assertCan(actor.role, "perio", "write");
  return dbForRequest(actor.organizationId, async (tx) => {
    const exam = await requireExam(tx, actor, examId);
    if (exam.completedAt) throw new PerioExamCompletedError();
    const [row] = await tx
      .insert(perioExamEvents)
      .values({
        organizationId: actor.organizationId,
        examId,
        kind: "phrase",
        heard: input.heard,
        used: input.used,
        outcome: input.outcome,
        note: input.note,
        changes: input.changes,
        createdBy: actor.userId,
      })
      .returning();
    return row;
  });
}

/** GET /perio-exams/:id/events — the transcript, oldest first, with who did each step. */
export async function listPerioExamEvents(actor: RequestActor, examId: string) {
  assertCan(actor.role, "perio", "read");
  return dbForRequest(actor.organizationId, async (tx) => {
    await requireExam(tx, actor, examId);
    return tx
      .select({ event: perioExamEvents, by: users.fullName })
      .from(perioExamEvents)
      .leftJoin(users, eq(users.id, perioExamEvents.createdBy))
      .where(eq(perioExamEvents.examId, examId))
      .orderBy(asc(perioExamEvents.createdAt), asc(perioExamEvents.id));
  });
}

/**
 * POST /perio-exams/:id/complete — approval. A dentist or hygienist, having reviewed the
 * transcript, approves the exam: it locks (docs/specs/perio.md) and becomes the permanent
 * record, with who and when (docs/specs/perio-approval.md).
 */
export async function completePerioExam(actor: RequestActor, examId: string) {
  assertCan(actor.role, "perio.approve", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireExam(tx, actor, examId);
    if (before.completedAt) throw new PerioExamCompletedError();

    const [after] = await tx
      .update(perioExams)
      .set({ completedAt: new Date(), approvedAt: new Date(), approvedBy: actor.userId, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(perioExams.id, examId))
      .returning();
    await tx.insert(perioExamEvents).values({ organizationId: actor.organizationId, examId, kind: "approved", createdBy: actor.userId });

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "perio_exam",
      entityId: examId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/**
 * POST /perio-exams/:id/uncomplete — reopens an approved exam for correction. Needs an
 * approver and a reason, which goes in the transcript; the exam must be approved again
 * (docs/specs/perio-approval.md). Audited same as every other mutation in this codebase.
 */
export async function uncompletePerioExam(actor: RequestActor, examId: string, reason: string) {
  assertCan(actor.role, "perio.approve", "write");
  if (!reason || reason.trim().length < 3) throw new PerioApprovalReasonRequiredError();

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireExam(tx, actor, examId);
    if (!before.completedAt) throw new PerioExamNotApprovedError();

    const [after] = await tx
      .update(perioExams)
      .set({ completedAt: null, approvedAt: null, approvedBy: null, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(perioExams.id, examId))
      .returning();
    await tx.insert(perioExamEvents).values({ organizationId: actor.organizationId, examId, kind: "reopened", note: reason.trim(), createdBy: actor.userId });

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "perio_exam",
      entityId: examId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

export interface PerioSiteDelta {
  tooth: string;
  site: string;
  cal_now: number | null;
  cal_before: number | null;
  delta: number | null;
  significant: boolean;
}

function calFor(site: (typeof perioSiteMeasurements.$inferSelect) | undefined): number | null {
  if (!site || site.pocketDepth === null || site.gingivalMargin === null) return null;
  return site.pocketDepth + site.gingivalMargin;
}

/**
 * GET /perio-exams/:id/compare?against= — prior exam delta, per site. `against` is optional;
 * when omitted, defaults to the most recent exam before this one for the same patient — the
 * common case per docs/specs/perio.md, zero extra clicks. A change of 2mm+ CAL is flagged
 * significant (vs. ~1mm normal probing-depth measurement variability).
 */
export async function comparePerioExam(actor: RequestActor, examId: string, against?: string) {
  assertCan(actor.role, "perio", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const exam = await requireExam(tx, actor, examId);

    let priorExamId = against;
    if (priorExamId) {
      // An explicit `against` is user-suppliable (the compare UI's baseline picker) — must
      // belong to the same patient, or this leaks another patient's CAL/site data as
      // "before" values. requireExam already org-scopes; PerioExamNotFoundError either way
      // (never a distinct "wrong patient" error) so this can't be used as an existence oracle
      // for another patient's exam ids.
      const priorExam = await requireExam(tx, actor, priorExamId);
      if (priorExam.patientId !== exam.patientId) throw new PerioExamNotFoundError();
    } else {
      const [prior] = await tx
        .select({ id: perioExams.id })
        .from(perioExams)
        .where(and(eq(perioExams.patientId, exam.patientId), isNull(perioExams.deletedAt), lt(perioExams.examDate, exam.examDate)))
        .orderBy(desc(perioExams.examDate))
        .limit(1);
      priorExamId = prior?.id;
    }

    const nowSites = await tx.select().from(perioSiteMeasurements).where(and(eq(perioSiteMeasurements.examId, examId), isNull(perioSiteMeasurements.deletedAt)));

    if (!priorExamId) {
      return {
        against_exam_id: null,
        deltas: nowSites.map((s) => ({ tooth: s.tooth, site: s.site, cal_now: calFor(s), cal_before: null, delta: null, significant: false })),
      };
    }

    const priorSites = await tx
      .select()
      .from(perioSiteMeasurements)
      .where(and(eq(perioSiteMeasurements.examId, priorExamId), isNull(perioSiteMeasurements.deletedAt)));
    const priorBySite = new Map(priorSites.map((s) => [`${s.tooth}:${s.site}`, s]));

    const deltas: PerioSiteDelta[] = nowSites.map((s) => {
      const before = priorBySite.get(`${s.tooth}:${s.site}`);
      const calNow = calFor(s);
      const calBefore = calFor(before);
      const delta = calNow !== null && calBefore !== null ? calNow - calBefore : null;
      return { tooth: s.tooth, site: s.site, cal_now: calNow, cal_before: calBefore, delta, significant: delta !== null && Math.abs(delta) >= 2 };
    });

    return { against_exam_id: priorExamId, deltas };
  });
}
