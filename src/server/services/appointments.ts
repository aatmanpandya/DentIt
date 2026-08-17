import { eq, and, ne, gte, lte, asc, or, isNull, sql, getTableColumns } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import {
  appointments,
  appointmentTypes,
  operatories,
  organizations,
  patients,
  providerSchedules,
  scheduleBlocks,
  users,
} from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { zonedDateTimeToInstant, zonedDayOfWeek, zonedDayRange, zonedTimeOfDay } from "@/server/lib/timezone";
import { writeAudit } from "./audit";
import { PatientNotFoundError } from "./patients";
import type { RequestActor } from "@/server/lib/request-auth";

export class AppointmentNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Appointment not found.");
    this.name = "AppointmentNotFoundError";
  }
}

export class OperatoryNotFoundError extends Error {
  constructor() {
    super("That operatory doesn't belong to the selected location.");
    this.name = "OperatoryNotFoundError";
  }
}

export class ProviderNotFoundError extends Error {
  constructor() {
    super("Provider not found.");
    this.name = "ProviderNotFoundError";
  }
}

// 409 — the DB's exclusion constraint (appointments_no_overlap in rls.sql) rejected this.
// No override: two patients cannot physically occupy the same chair at once.
export class AppointmentConflictError extends Error {
  constructor(operatoryName: string, time: string) {
    super(`${operatoryName} already has an appointment at ${time}. Pick another time or operatory.`);
    this.name = "AppointmentConflictError";
  }
}

// 422, warn-with-override — see docs/specs/validation-and-errors.md's APPOINTMENT_OUTSIDE_HOURS.
export class AppointmentOutsideHoursError extends Error {
  constructor(providerName: string) {
    super(`${providerName} isn't scheduled at this time. Book anyway?`);
    this.name = "AppointmentOutsideHoursError";
  }
}

// 422, warn-with-override — APPOINTMENT_BLOCKED_PERIOD (holiday/lunch/leave).
export class AppointmentBlockedPeriodError extends Error {
  constructor(reason: string) {
    super(`This time overlaps "${reason}". Book anyway?`);
    this.name = "AppointmentBlockedPeriodError";
  }
}

// 422, warn-with-override — new for Day 7. A provider can only be in one operatory at
// once, but that's not something the operatory-scoped DB exclusion constraint can catch;
// some clinics do run a floating provider across chairs, so this warns rather than blocks.
export class AppointmentProviderConflictError extends Error {
  constructor(providerName: string, operatoryName: string, time: string) {
    super(`${providerName} is already booked in ${operatoryName} at ${time}. Book anyway?`);
    this.name = "AppointmentProviderConflictError";
  }
}

// 422 — see docs/specs/pilot-foundations.md §3 for the full transition table.
export class IllegalTransitionError extends Error {
  constructor(from: string, to: string, legal: string[]) {
    super(
      legal.length === 0
        ? `A ${from} appointment can't be changed.`
        : `Can't move from ${from} to ${to}. Legal next steps: ${legal.join(", ")}.`,
    );
    this.name = "IllegalTransitionError";
  }
}

function isExclusionViolation(err: unknown): boolean {
  // Postgres 23P01 = exclusion_violation, the counterpart to catalog.ts's 23505 check.
  // Falls back to the message text since postgres.js doesn't consistently surface
  // `.code` the same way across every error path a transaction rollback can take.
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && (err as { code: unknown }).code === "23P01") return true;
  return err instanceof Error && err.message.includes("exclusion constraint");
}

type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

const LEGAL_TRANSITIONS: Record<string, string[]> = {
  scheduled: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["seated", "no_show"],
  seated: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

const NON_TERMINAL = ["scheduled", "confirmed", "arrived", "seated"];

function formatTime(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone, hour: "2-digit", minute: "2-digit" });
}

async function requireAppointment(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw new AppointmentNotFoundError();
  return row;
}

async function requirePatient(tx: Tx, actor: RequestActor, patientId: string) {
  const [row] = await tx
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, actor.organizationId), isNull(patients.deletedAt)))
    .limit(1);
  if (!row) throw new PatientNotFoundError();
  return row;
}

async function requireOperatory(tx: Tx, actor: RequestActor, operatoryId: string, locationId: string) {
  const [row] = await tx
    .select()
    .from(operatories)
    .where(
      and(
        eq(operatories.id, operatoryId),
        eq(operatories.organizationId, actor.organizationId),
        eq(operatories.locationId, locationId),
      ),
    )
    .limit(1);
  if (!row) throw new OperatoryNotFoundError();
  return row;
}

async function requireProvider(tx: Tx, actor: RequestActor, providerId: string) {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, providerId), eq(users.organizationId, actor.organizationId), eq(users.isActive, true)))
    .limit(1);
  if (!row) throw new ProviderNotFoundError();
  return row;
}

async function requireOrgTimezone(tx: Tx, actor: RequestActor) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.organizationId)).limit(1);
  return org?.timezone ?? "Asia/Kolkata";
}

interface SlotCheckInput {
  locationId: string;
  operatoryId: string;
  providerId: string;
  startsAt: Date;
  endsAt: Date;
  excludeAppointmentId?: string;
}

/**
 * The two warn-with-override checks shared by create/update/reschedule: is the slot
 * inside a schedule_blocks period, and is it inside the provider's working hours?
 * Both throw unless `override` is set — the DB exclusion constraint (caught separately
 * by the caller) is the only check that can never be overridden.
 *
 * Takes `timeZone` as a parameter rather than looking it up itself — callers must fetch
 * it before attempting the write that can hit the exclusion constraint. Once any
 * statement in a Postgres transaction fails, the whole transaction is aborted and every
 * later statement on the same `tx` (including a fresh SELECT for the error message)
 * fails too, clobbering the real error we meant to throw.
 */
async function checkWarnings(tx: Tx, actor: RequestActor, input: SlotCheckInput, override: boolean | undefined, timeZone: string) {
  if (override) return;

  const blocks = await tx
    .select()
    .from(scheduleBlocks)
    .where(
      and(
        eq(scheduleBlocks.organizationId, actor.organizationId),
        or(isNull(scheduleBlocks.locationId), eq(scheduleBlocks.locationId, input.locationId)),
        or(isNull(scheduleBlocks.providerId), eq(scheduleBlocks.providerId, input.providerId)),
        or(isNull(scheduleBlocks.operatoryId), eq(scheduleBlocks.operatoryId, input.operatoryId)),
        sql`${scheduleBlocks.startsAt} < ${input.endsAt.toISOString()}`,
        sql`${scheduleBlocks.endsAt} > ${input.startsAt.toISOString()}`,
      ),
    )
    .limit(1);
  if (blocks[0]) throw new AppointmentBlockedPeriodError(blocks[0].reason);

  const dayOfWeek = zonedDayOfWeek(input.startsAt, timeZone);
  const dateStr = input.startsAt.toLocaleDateString("en-CA", { timeZone });
  const startTime = zonedTimeOfDay(input.startsAt, timeZone);
  const endTime = zonedTimeOfDay(input.endsAt, timeZone);

  const schedules = await tx
    .select()
    .from(providerSchedules)
    .where(
      and(
        eq(providerSchedules.organizationId, actor.organizationId),
        eq(providerSchedules.providerId, input.providerId),
        eq(providerSchedules.locationId, input.locationId),
        eq(providerSchedules.dayOfWeek, dayOfWeek),
        lte(providerSchedules.effectiveFrom, dateStr),
        or(isNull(providerSchedules.effectiveTo), gte(providerSchedules.effectiveTo, dateStr)),
      ),
    );

  const withinHours = schedules.some((s) => s.startTime <= startTime && s.endTime >= endTime);
  if (!withinHours) {
    const [provider] = await tx.select().from(users).where(eq(users.id, input.providerId)).limit(1);
    throw new AppointmentOutsideHoursError(provider?.fullName ?? "This provider");
  }

  const providerConflictConditions = [
    eq(appointments.organizationId, actor.organizationId),
    eq(appointments.providerId, input.providerId),
    ne(appointments.operatoryId, input.operatoryId),
    sql`${appointments.status} in ('scheduled', 'confirmed', 'arrived', 'seated')`,
    sql`${appointments.startsAt} < ${input.endsAt.toISOString()}`,
    sql`${appointments.endsAt} > ${input.startsAt.toISOString()}`,
  ];
  if (input.excludeAppointmentId) providerConflictConditions.push(ne(appointments.id, input.excludeAppointmentId));

  const [providerConflict] = await tx
    .select({ id: appointments.id, operatoryId: appointments.operatoryId, startsAt: appointments.startsAt })
    .from(appointments)
    .where(and(...providerConflictConditions))
    .limit(1);
  if (providerConflict) {
    const [provider] = await tx.select().from(users).where(eq(users.id, input.providerId)).limit(1);
    const [conflictOperatory] = await tx.select().from(operatories).where(eq(operatories.id, providerConflict.operatoryId)).limit(1);
    throw new AppointmentProviderConflictError(
      provider?.fullName ?? "This provider",
      conflictOperatory?.name ?? "another operatory",
      formatTime(providerConflict.startsAt.toISOString(), timeZone),
    );
  }
}

export interface CreateAppointmentInput {
  patient_id: string;
  location_id: string;
  operatory_id: string;
  provider_id: string;
  appointment_type_id?: string | null;
  starts_at: string;
  ends_at: string;
  note?: string | null;
  override?: boolean;
}

export async function createAppointment(actor: RequestActor, input: CreateAppointmentInput) {
  assertCan(actor.role, "appointments", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const timeZone = await requireOrgTimezone(tx, actor);
    await requirePatient(tx, actor, input.patient_id);
    const operatory = await requireOperatory(tx, actor, input.operatory_id, input.location_id);
    await requireProvider(tx, actor, input.provider_id);

    const startsAt = new Date(input.starts_at);
    const endsAt = new Date(input.ends_at);

    await checkWarnings(
      tx,
      actor,
      { locationId: input.location_id, operatoryId: input.operatory_id, providerId: input.provider_id, startsAt, endsAt },
      input.override,
      timeZone,
    );

    let created;
    try {
      [created] = await tx
        .insert(appointments)
        .values({
          organizationId: actor.organizationId,
          locationId: input.location_id,
          operatoryId: input.operatory_id,
          patientId: input.patient_id,
          providerId: input.provider_id,
          appointmentTypeId: input.appointment_type_id ?? null,
          startsAt,
          endsAt,
          note: input.note ?? null,
          createdBy: actor.userId,
        })
        .returning();
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new AppointmentConflictError(operatory.name, formatTime(input.starts_at, timeZone));
      }
      throw err;
    }

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "appointment",
      entityId: created.id,
      action: "create",
      after: created,
    });

    return created;
  });
}

export async function getAppointment(actor: RequestActor, id: string) {
  assertCan(actor.role, "appointments", "read");
  return dbForRequest(actor.organizationId, (tx) => requireAppointment(tx, actor, id));
}

export interface ListAppointmentsInput {
  location_id: string;
  date?: string;
  from?: string;
  to?: string;
  provider_id?: string;
  operatory_id?: string;
}

export async function listAppointments(actor: RequestActor, input: ListAppointmentsInput) {
  assertCan(actor.role, "appointments", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const timeZone = await requireOrgTimezone(tx, actor);
    const range = input.date
      ? zonedDayRange(input.date, timeZone)
      : { start: zonedDayRange(input.from!, timeZone).start, end: zonedDayRange(input.to!, timeZone).end };

    const conditions = [
      eq(appointments.organizationId, actor.organizationId),
      eq(appointments.locationId, input.location_id),
      gte(appointments.startsAt, range.start),
      sql`${appointments.startsAt} < ${range.end.toISOString()}`,
    ];
    if (input.provider_id) conditions.push(eq(appointments.providerId, input.provider_id));
    if (input.operatory_id) conditions.push(eq(appointments.operatoryId, input.operatory_id));

    // Joins the patient's name in — the day view renders a name on every block, and
    // fetching that per-appointment from the client would be N+1. See serializeAppointment
    // in serialize-appointments.ts for how patient_first_name/patient_last_name surface.
    return tx
      .select({
        ...getTableColumns(appointments),
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(and(...conditions))
      .orderBy(appointments.startsAt);
  });
}

export interface UpdateAppointmentInput {
  operatory_id?: string;
  provider_id?: string;
  starts_at?: string;
  ends_at?: string;
  note?: string | null;
  override?: boolean;
}

export async function updateAppointment(actor: RequestActor, id: string, input: UpdateAppointmentInput) {
  assertCan(actor.role, "appointments", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const timeZone = await requireOrgTimezone(tx, actor);
    const before = await requireAppointment(tx, actor, id);

    const slotChanged = input.operatory_id !== undefined || input.provider_id !== undefined || input.starts_at !== undefined || input.ends_at !== undefined;

    const operatoryId = input.operatory_id ?? before.operatoryId;
    const providerId = input.provider_id ?? before.providerId;
    const startsAt = input.starts_at ? new Date(input.starts_at) : before.startsAt;
    const endsAt = input.ends_at ? new Date(input.ends_at) : before.endsAt;

    let operatoryName = "This operatory";
    if (slotChanged) {
      const operatory = await requireOperatory(tx, actor, operatoryId, before.locationId);
      operatoryName = operatory.name;
      if (input.provider_id) await requireProvider(tx, actor, input.provider_id);

      await checkWarnings(
        tx,
        actor,
        { locationId: before.locationId, operatoryId, providerId, startsAt, endsAt, excludeAppointmentId: id },
        input.override,
        timeZone,
      );
    }

    const patch: Partial<typeof appointments.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.operatory_id !== undefined) patch.operatoryId = input.operatory_id;
    if (input.provider_id !== undefined) patch.providerId = input.provider_id;
    if (input.starts_at !== undefined) patch.startsAt = startsAt;
    if (input.ends_at !== undefined) patch.endsAt = endsAt;
    if (input.note !== undefined) patch.note = input.note;

    let after;
    try {
      [after] = await tx.update(appointments).set(patch).where(eq(appointments.id, id)).returning();
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new AppointmentConflictError(operatoryName, formatTime(startsAt.toISOString(), timeZone));
      }
      throw err;
    }

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "appointment",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

export interface TransitionAppointmentInput {
  to_status: string;
  reason?: string;
  cancelled_by?: "patient" | "practice";
}

export async function transitionAppointment(actor: RequestActor, id: string, input: TransitionAppointmentInput) {
  assertCan(actor.role, "appointments", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireAppointment(tx, actor, id);
    const legal = LEGAL_TRANSITIONS[before.status] ?? [];
    if (!legal.includes(input.to_status)) {
      throw new IllegalTransitionError(before.status, input.to_status, legal);
    }

    const now = new Date();
    const patch: Partial<typeof appointments.$inferInsert> = {
      status: input.to_status as (typeof appointments.$inferInsert)["status"],
      updatedBy: actor.userId,
      updatedAt: now,
    };
    if (input.to_status === "confirmed") patch.confirmedAt = now;
    if (input.to_status === "arrived") patch.arrivedAt = now;
    if (input.to_status === "seated") patch.seatedAt = now;
    if (input.to_status === "completed") patch.completedAt = now;
    if (input.to_status === "cancelled") {
      patch.cancelledAt = now;
      patch.cancelledBy = input.cancelled_by ?? null;
      patch.cancellationReason = input.reason ?? null;
    }

    const [after] = await tx.update(appointments).set(patch).where(eq(appointments.id, id)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "appointment",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/**
 * Read-only for the pilot — appointment types are seeded, not editable through the API
 * yet (no clinic has asked to add one mid-pilot). Structural reference data, same
 * authentication-only tier as listLocations/listOperatories/listProviders.
 */
export async function listAppointmentTypes(actor: RequestActor) {
  return dbForRequest(actor.organizationId, async (tx) => {
    return tx
      .select()
      .from(appointmentTypes)
      .where(and(eq(appointmentTypes.organizationId, actor.organizationId), eq(appointmentTypes.isActive, true)))
      .orderBy(asc(appointmentTypes.name));
  });
}

export interface ListScheduleBlocksInput {
  location_id?: string;
  from: string;
  to: string;
}

/** Read-only for the pilot — nothing in the day view creates a schedule_blocks row yet. */
export async function listScheduleBlocks(actor: RequestActor, input: ListScheduleBlocksInput) {
  return dbForRequest(actor.organizationId, async (tx) => {
    const timeZone = await requireOrgTimezone(tx, actor);
    const from = zonedDayRange(input.from, timeZone).start;
    const to = zonedDayRange(input.to, timeZone).end;

    const conditions = [
      eq(scheduleBlocks.organizationId, actor.organizationId),
      sql`${scheduleBlocks.startsAt} < ${to.toISOString()}`,
      sql`${scheduleBlocks.endsAt} > ${from.toISOString()}`,
    ];
    if (input.location_id) {
      conditions.push(or(isNull(scheduleBlocks.locationId), eq(scheduleBlocks.locationId, input.location_id))!);
    }

    return tx
      .select()
      .from(scheduleBlocks)
      .where(and(...conditions))
      .orderBy(asc(scheduleBlocks.startsAt));
  });
}

// Step size for candidate slot starts — mirrors GRID_SNAP_MINUTES in
// src/components/schedule/time-grid.ts. Duplicated rather than imported for the same
// reason documented there: that module runs in the browser, this runs on the server.
const AVAILABILITY_STEP_MINUTES = 15;

export interface GetAvailabilityInput {
  location_id: string;
  provider_id: string;
  date: string;
  duration_minutes: number;
}

export interface AvailabilitySlot {
  starts_at: string;
  ends_at: string;
}

/**
 * Server-computed on purpose (see docs/specs/api-surface.md's "/availability is
 * server-computed") — nothing in the shipped UI calls this yet, it exists ahead of a
 * future "suggest a free slot" feature per the Days 7-10 plan. Returns candidate
 * `duration_minutes`-long slots, stepped every AVAILABILITY_STEP_MINUTES, inside the
 * provider's working hours for that date and clear of both existing appointments and
 * schedule_blocks. Doesn't resolve a specific operatory — that's chosen once a slot is
 * picked, same as the create panel already works.
 */
export async function getAvailability(actor: RequestActor, input: GetAvailabilityInput): Promise<AvailabilitySlot[]> {
  assertCan(actor.role, "appointments", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const timeZone = await requireOrgTimezone(tx, actor);
    await requireProvider(tx, actor, input.provider_id);

    const dayRange = zonedDayRange(input.date, timeZone);
    const dayOfWeek = zonedDayOfWeek(dayRange.start, timeZone);

    const schedules = await tx
      .select()
      .from(providerSchedules)
      .where(
        and(
          eq(providerSchedules.organizationId, actor.organizationId),
          eq(providerSchedules.providerId, input.provider_id),
          eq(providerSchedules.locationId, input.location_id),
          eq(providerSchedules.dayOfWeek, dayOfWeek),
          lte(providerSchedules.effectiveFrom, input.date),
          or(isNull(providerSchedules.effectiveTo), gte(providerSchedules.effectiveTo, input.date)),
        ),
      );
    if (schedules.length === 0) return [];

    const busyAppointments = await tx
      .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, actor.organizationId),
          eq(appointments.providerId, input.provider_id),
          sql`${appointments.status} in ('scheduled', 'confirmed', 'arrived', 'seated')`,
          gte(appointments.startsAt, dayRange.start),
          sql`${appointments.startsAt} < ${dayRange.end.toISOString()}`,
        ),
      );

    const blocks = await tx
      .select({ startsAt: scheduleBlocks.startsAt, endsAt: scheduleBlocks.endsAt })
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.organizationId, actor.organizationId),
          or(isNull(scheduleBlocks.locationId), eq(scheduleBlocks.locationId, input.location_id)),
          or(isNull(scheduleBlocks.providerId), eq(scheduleBlocks.providerId, input.provider_id)),
          sql`${scheduleBlocks.startsAt} < ${dayRange.end.toISOString()}`,
          sql`${scheduleBlocks.endsAt} > ${dayRange.start.toISOString()}`,
        ),
      );

    const busy = [...busyAppointments, ...blocks]
      .map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() }))
      .sort((a, b) => a.start - b.start);

    const durationMs = input.duration_minutes * 60_000;
    const stepMs = AVAILABILITY_STEP_MINUTES * 60_000;
    const slots: AvailabilitySlot[] = [];

    for (const schedule of schedules) {
      const windowStart = zonedDateTimeToInstant(input.date, schedule.startTime, timeZone).getTime();
      const windowEnd = zonedDateTimeToInstant(input.date, schedule.endTime, timeZone).getTime();

      for (let slotStart = windowStart; slotStart + durationMs <= windowEnd; slotStart += stepMs) {
        const slotEnd = slotStart + durationMs;
        const overlapsBusy = busy.some((b) => slotStart < b.end && slotEnd > b.start);
        if (!overlapsBusy) {
          slots.push({ starts_at: new Date(slotStart).toISOString(), ends_at: new Date(slotEnd).toISOString() });
        }
      }
    }

    return slots;
  });
}

export interface RescheduleAppointmentInput {
  starts_at: string;
  ends_at: string;
  operatory_id: string;
  provider_id?: string;
  override?: boolean;
}

/**
 * Cancels the original appointment and creates a new one, linked by rescheduled_to_id —
 * never mutates the original's time in place, so the audit trail shows both. Distinct
 * from updateAppointment (drag-to-move), which is a same-day logistics correction on
 * the same row. See docs/specs/pilot-foundations.md §3.
 */
export async function rescheduleAppointment(actor: RequestActor, id: string, input: RescheduleAppointmentInput) {
  assertCan(actor.role, "appointments", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const timeZone = await requireOrgTimezone(tx, actor);
    const before = await requireAppointment(tx, actor, id);
    if (!NON_TERMINAL.includes(before.status)) {
      throw new IllegalTransitionError(before.status, "rescheduled", []);
    }

    const operatory = await requireOperatory(tx, actor, input.operatory_id, before.locationId);
    const providerId = input.provider_id ?? before.providerId;
    if (input.provider_id) await requireProvider(tx, actor, input.provider_id);

    const startsAt = new Date(input.starts_at);
    const endsAt = new Date(input.ends_at);

    await checkWarnings(
      tx,
      actor,
      { locationId: before.locationId, operatoryId: input.operatory_id, providerId, startsAt, endsAt },
      input.override,
      timeZone,
    );

    let created;
    try {
      [created] = await tx
        .insert(appointments)
        .values({
          organizationId: actor.organizationId,
          locationId: before.locationId,
          operatoryId: input.operatory_id,
          patientId: before.patientId,
          providerId,
          appointmentTypeId: before.appointmentTypeId,
          startsAt,
          endsAt,
          note: before.note,
          createdBy: actor.userId,
        })
        .returning();
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new AppointmentConflictError(operatory.name, formatTime(input.starts_at, timeZone));
      }
      throw err;
    }

    const [cancelledOriginal] = await tx
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: "practice",
        cancellationReason: "Rescheduled",
        rescheduledToId: created.id,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "appointment",
      entityId: id,
      action: "update",
      before,
      after: cancelledOriginal,
    });
    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "appointment",
      entityId: created.id,
      action: "create",
      after: created,
    });

    return created;
  });
}
