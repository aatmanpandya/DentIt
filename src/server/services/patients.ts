import { eq, and, isNull, gt, gte, or, ilike, notInArray, desc, asc, sql } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import { patients, responsibleParties, patientAlerts, appointments, invoices, paymentAllocations } from "@/server/db/schema";
import { assertCan, PermissionDeniedError } from "@/server/lib/permissions";
import { writeAudit } from "./audit";
import type { RequestActor } from "@/server/lib/request-auth";

export class PatientNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    // RLS already makes a wrong-org id return no rows; this is the same "not found"
    // whether the id is missing entirely or just belongs to someone else's clinic.
    super("Patient not found.");
    this.name = "PatientNotFoundError";
  }
}

export class PatientAlertNotFoundError extends Error {
  constructor() {
    super("Alert not found.");
    this.name = "PatientAlertNotFoundError";
  }
}

export interface CreatePatientInput {
  first_name: string;
  last_name: string;
  phone: string;
  date_of_birth?: string | null;
  sex?: "male" | "female" | "other" | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  preferred_location_id?: string | null;
  notes?: string | null;
  responsible_party?: {
    full_name: string;
    phone: string;
    email?: string | null;
    relationship: string;
    address_line1?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
  } | null;
}

/**
 * Per-org sequential number, human-facing (docs/specs/data-model.md). Not a Postgres
 * sequence — sequences aren't naturally per-tenant, and the unique index on
 * (organization_id, patient_number) is the real guard against a race producing a
 * duplicate; this just picks a plausible next value inside the same transaction.
 */
async function nextPatientNumber(tx: Parameters<Parameters<typeof dbForRequest>[1]>[0], organizationId: string) {
  const [row] = await tx
    .select({ patientNumber: patients.patientNumber })
    .from(patients)
    .where(eq(patients.organizationId, organizationId))
    .orderBy(sql`${patients.patientNumber} desc`)
    .limit(1);

  const lastSeq = row ? Number(row.patientNumber.replace(/^P-/, "")) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `P-${String(next).padStart(4, "0")}`;
}

export async function createPatient(actor: RequestActor, input: CreatePatientInput) {
  assertCan(actor.role, "patients", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    let responsiblePartyId: string | null = null;
    if (input.responsible_party) {
      const [rp] = await tx
        .insert(responsibleParties)
        .values({
          organizationId: actor.organizationId,
          fullName: input.responsible_party.full_name,
          phone: input.responsible_party.phone,
          email: input.responsible_party.email ?? null,
          relationship: input.responsible_party.relationship,
          addressLine1: input.responsible_party.address_line1 ?? null,
          city: input.responsible_party.city ?? null,
          state: input.responsible_party.state ?? null,
          postalCode: input.responsible_party.postal_code ?? null,
          createdBy: actor.userId,
        })
        .returning();
      responsiblePartyId = rp.id;
    }

    const patientNumber = await nextPatientNumber(tx, actor.organizationId);

    const [patient] = await tx
      .insert(patients)
      .values({
        organizationId: actor.organizationId,
        patientNumber,
        firstName: input.first_name,
        lastName: input.last_name,
        phone: input.phone,
        dateOfBirth: input.date_of_birth ?? null,
        sex: input.sex ?? null,
        email: input.email ?? null,
        addressLine1: input.address_line1 ?? null,
        addressLine2: input.address_line2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postal_code ?? null,
        preferredLocationId: input.preferred_location_id ?? null,
        responsiblePartyId,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "patient",
      entityId: patient.id,
      action: "create",
      after: patient,
    });

    return patient;
  });
}

export async function getPatient(actor: RequestActor, id: string) {
  assertCan(actor.role, "patients", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [patient] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
      .limit(1);

    if (!patient) throw new PatientNotFoundError();
    return patient;
  });
}

export interface ListPatientsInput {
  q?: string;
  location_id?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Cursor is the last patient_number of the previous page — it's already unique per
 * org (docs/specs/data-model.md's unique index) and sorts naturally, so no separate
 * opaque-token encoding is needed. See docs/specs/api-surface.md for the pagination shape.
 */
export async function listPatients(actor: RequestActor, input: ListPatientsInput = {}) {
  assertCan(actor.role, "patients", "read");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  return dbForRequest(actor.organizationId, async (tx) => {
    const conditions = [isNull(patients.deletedAt)];
    if (input.cursor) conditions.push(gt(patients.patientNumber, input.cursor));
    if (input.location_id) conditions.push(eq(patients.preferredLocationId, input.location_id));
    // q searches name, phone, patient number — see docs/specs/api-surface.md. The GIN
    // trigram index on (first_name || ' ' || last_name) is what keeps the name branch
    // fast; see rls.sql.
    if (input.q) {
      const term = `%${input.q}%`;
      const nameOrPhoneOrNumber = or(
        ilike(sql`(${patients.firstName} || ' ' || ${patients.lastName})`, term),
        ilike(patients.phone, term),
        ilike(patients.patientNumber, term),
      );
      if (nameOrPhoneOrNumber) conditions.push(nameOrPhoneOrNumber);
    }

    const rows = await tx
      .select()
      .from(patients)
      .where(and(...conditions))
      .orderBy(patients.patientNumber)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].patientNumber : null;

    return { data, nextCursor };
  });
}

export type UpdatePatientInput = Partial<CreatePatientInput> & { is_active?: boolean };

export async function updatePatient(actor: RequestActor, id: string, input: UpdatePatientInput) {
  assertCan(actor.role, "patients", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
      .limit(1);
    if (!before) throw new PatientNotFoundError();

    let responsiblePartyId = before.responsiblePartyId;
    if (input.responsible_party) {
      const rpValues = {
        fullName: input.responsible_party.full_name,
        phone: input.responsible_party.phone,
        email: input.responsible_party.email ?? null,
        relationship: input.responsible_party.relationship,
        addressLine1: input.responsible_party.address_line1 ?? null,
        city: input.responsible_party.city ?? null,
        state: input.responsible_party.state ?? null,
        postalCode: input.responsible_party.postal_code ?? null,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (responsiblePartyId) {
        await tx.update(responsibleParties).set(rpValues).where(eq(responsibleParties.id, responsiblePartyId));
      } else {
        const [rp] = await tx
          .insert(responsibleParties)
          .values({ organizationId: actor.organizationId, createdBy: actor.userId, ...rpValues })
          .returning();
        responsiblePartyId = rp.id;
      }
    }

    const patch: Partial<typeof patients.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.first_name !== undefined) patch.firstName = input.first_name;
    if (input.last_name !== undefined) patch.lastName = input.last_name;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.date_of_birth !== undefined) patch.dateOfBirth = input.date_of_birth;
    if (input.sex !== undefined) patch.sex = input.sex;
    if (input.email !== undefined) patch.email = input.email;
    if (input.address_line1 !== undefined) patch.addressLine1 = input.address_line1;
    if (input.address_line2 !== undefined) patch.addressLine2 = input.address_line2;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state !== undefined) patch.state = input.state;
    if (input.postal_code !== undefined) patch.postalCode = input.postal_code;
    if (input.preferred_location_id !== undefined) patch.preferredLocationId = input.preferred_location_id;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.is_active !== undefined) patch.isActive = input.is_active;
    if (responsiblePartyId !== before.responsiblePartyId) patch.responsiblePartyId = responsiblePartyId;

    const [after] = await tx.update(patients).set(patch).where(eq(patients.id, id)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "patient",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/**
 * Stricter than the generic `patients` write permission — docs/specs/api-surface.md
 * calls out deletion as owner/admin only, unlike create/update which every clinical
 * and front-desk role can do. Checked explicitly rather than through a new resource
 * in the RBAC matrix, since it's the only action with this narrower gate.
 */
export async function deletePatient(actor: RequestActor, id: string) {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new PermissionDeniedError(actor.role, "patients", "write");
  }

  return dbForRequest(actor.organizationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
      .limit(1);
    if (!before) throw new PatientNotFoundError();

    const [after] = await tx
      .update(patients)
      .set({ deletedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(patients.id, id))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "patient",
      entityId: id,
      action: "delete",
      before,
      after,
    });
  });
}

export interface CreatePatientAlertInput {
  alert_type: "allergy" | "medical" | "precaution";
  label: string;
  detail?: string | null;
  severity?: "info" | "warning" | "critical";
}

export interface UpdatePatientAlertInput {
  label?: string;
  detail?: string | null;
  severity?: "info" | "warning" | "critical";
  is_active?: boolean;
}

// Alerts share the `patients` RBAC resource — the matrix doesn't call out a separate
// entry for them, and they're shown on every clinical screen as part of the patient's
// own record (docs/specs/data-model.md).
export async function listPatientAlerts(actor: RequestActor, patientId: string) {
  assertCan(actor.role, "patients", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    return tx
      .select()
      .from(patientAlerts)
      .where(and(eq(patientAlerts.patientId, patientId), isNull(patientAlerts.deletedAt)));
  });
}

export async function createPatientAlert(actor: RequestActor, patientId: string, input: CreatePatientAlertInput) {
  assertCan(actor.role, "patients", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [patient] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, patientId), isNull(patients.deletedAt)))
      .limit(1);
    if (!patient) throw new PatientNotFoundError();

    const [alert] = await tx
      .insert(patientAlerts)
      .values({
        organizationId: actor.organizationId,
        patientId,
        alertType: input.alert_type,
        label: input.label,
        detail: input.detail ?? null,
        severity: input.severity ?? "warning",
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "patient_alert",
      entityId: alert.id,
      action: "create",
      after: alert,
    });

    return alert;
  });
}

export async function updatePatientAlert(actor: RequestActor, alertId: string, input: UpdatePatientAlertInput) {
  assertCan(actor.role, "patients", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(patientAlerts)
      .where(and(eq(patientAlerts.id, alertId), isNull(patientAlerts.deletedAt)))
      .limit(1);
    if (!before) throw new PatientAlertNotFoundError();

    const patch: Partial<typeof patientAlerts.$inferInsert> = { updatedBy: actor.userId, updatedAt: new Date() };
    if (input.label !== undefined) patch.label = input.label;
    if (input.detail !== undefined) patch.detail = input.detail;
    if (input.severity !== undefined) patch.severity = input.severity;
    if (input.is_active !== undefined) patch.isActive = input.is_active;

    const [after] = await tx.update(patientAlerts).set(patch).where(eq(patientAlerts.id, alertId)).returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "patient_alert",
      entityId: alertId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/**
 * The chart header is one request, not five — docs/specs/api-surface.md. Queries
 * appointments/invoices/payments directly rather than through a dedicated service:
 * those domains don't have write-side services yet (scheduling lands days 7-10,
 * ledger day 20), but the tables already exist and a read-only rollup doesn't need
 * to wait on the write side. Returns real zeros/nulls today, not stubbed values —
 * it starts reporting real data the moment those days land, with no rewrite.
 */
export async function getPatientSummary(actor: RequestActor, id: string) {
  assertCan(actor.role, "patients", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    const [patient] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
      .limit(1);
    if (!patient) throw new PatientNotFoundError();

    const alerts = await tx
      .select()
      .from(patientAlerts)
      .where(and(eq(patientAlerts.patientId, id), eq(patientAlerts.isActive, true), isNull(patientAlerts.deletedAt)));

    const [nextAppointment] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, id),
          gte(appointments.startsAt, new Date()),
          notInArray(appointments.status, ["cancelled", "no_show", "completed"]),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(1);

    const [lastVisit] = await tx
      .select({ startsAt: appointments.startsAt })
      .from(appointments)
      .where(and(eq(appointments.patientId, id), eq(appointments.status, "completed")))
      .orderBy(desc(appointments.startsAt))
      .limit(1);

    const [{ invoiced }] = await tx
      .select({ invoiced: sql<string>`coalesce(sum(${invoices.total}), 0)` })
      .from(invoices)
      .where(and(eq(invoices.patientId, id), eq(invoices.status, "issued")));

    const [{ paid }] = await tx
      .select({ paid: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(paymentAllocations.invoiceId, invoices.id))
      .where(and(eq(invoices.patientId, id), eq(invoices.status, "issued")));

    return {
      alerts,
      nextAppointment: nextAppointment ?? null,
      lastVisitAt: lastVisit?.startsAt ?? null,
      balance: (Number(invoiced) - Number(paid)).toFixed(2),
    };
  });
}
