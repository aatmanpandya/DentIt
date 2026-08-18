import { eq, and, isNull, desc } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import { clinicalNotes, patients } from "@/server/db/schema";
import { assertCan } from "@/server/lib/permissions";
import { writeAudit } from "./audit";
import { PatientNotFoundError } from "./patients";
import type { RequestActor } from "@/server/lib/request-auth";

export { PatientNotFoundError };

export class NoteNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Note not found.");
    this.name = "NoteNotFoundError";
  }
}

// 422 — NOTE_ALREADY_SIGNED. Exact wording per docs/specs/validation-and-errors.md.
export class NoteAlreadySignedError extends Error {
  constructor() {
    super("Signed notes can't be edited. Add an amendment instead.");
    this.name = "NoteAlreadySignedError";
  }
}

type Tx = Parameters<Parameters<typeof dbForRequest>[1]>[0];

async function requirePatient(tx: Tx, actor: RequestActor, patientId: string) {
  const [row] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.organizationId, actor.organizationId), isNull(patients.deletedAt)))
    .limit(1);
  if (!row) throw new PatientNotFoundError();
  return row;
}

async function requireNote(tx: Tx, actor: RequestActor, id: string) {
  const [row] = await tx
    .select()
    .from(clinicalNotes)
    .where(and(eq(clinicalNotes.id, id), eq(clinicalNotes.organizationId, actor.organizationId), isNull(clinicalNotes.deletedAt)))
    .limit(1);
  if (!row) throw new NoteNotFoundError();
  return row;
}

// --- Read ---

export async function listPatientNotes(actor: RequestActor, patientId: string) {
  assertCan(actor.role, "clinical_notes", "read");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);

    return tx
      .select()
      .from(clinicalNotes)
      .where(and(eq(clinicalNotes.patientId, patientId), isNull(clinicalNotes.deletedAt)))
      .orderBy(desc(clinicalNotes.createdAt));
  });
}

// --- Write ---

export interface CreateNoteInput {
  body: string;
  appointment_id?: string | null;
}

export async function createNote(actor: RequestActor, patientId: string, input: CreateNoteInput) {
  assertCan(actor.role, "clinical_notes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    await requirePatient(tx, actor, patientId);

    const [note] = await tx
      .insert(clinicalNotes)
      .values({
        organizationId: actor.organizationId,
        patientId,
        appointmentId: input.appointment_id ?? null,
        providerId: actor.userId,
        body: input.body,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "clinical_note",
      entityId: note.id,
      action: "create",
      after: note,
    });

    return note;
  });
}

export interface UpdateNoteInput {
  body: string;
}

/** PATCH /notes/:id — unsigned only. A signed note is edited via amend, never in place. */
export async function updateNote(actor: RequestActor, id: string, input: UpdateNoteInput) {
  assertCan(actor.role, "clinical_notes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireNote(tx, actor, id);
    if (before.signedAt) throw new NoteAlreadySignedError();

    const [after] = await tx
      .update(clinicalNotes)
      .set({ body: input.body, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(clinicalNotes.id, id))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "clinical_note",
      entityId: id,
      action: "update",
      before,
      after,
    });

    return after;
  });
}

/** POST /notes/:id/sign — immutable from this point forward. Nobody, including Owner, can edit it back. */
export async function signNote(actor: RequestActor, id: string) {
  assertCan(actor.role, "clinical_notes.sign", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireNote(tx, actor, id);
    if (before.signedAt) throw new NoteAlreadySignedError();

    const now = new Date();
    const [after] = await tx
      .update(clinicalNotes)
      .set({ signedAt: now, signedBy: actor.userId, updatedBy: actor.userId, updatedAt: now })
      .where(eq(clinicalNotes.id, id))
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "clinical_note",
      entityId: id,
      action: "sign",
      before,
      after,
    });

    return after;
  });
}

/** DELETE /notes/:id — unsigned only, same rule as PATCH. A signed note can never be removed. */
export async function deleteNote(actor: RequestActor, id: string) {
  assertCan(actor.role, "clinical_notes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const before = await requireNote(tx, actor, id);
    if (before.signedAt) throw new NoteAlreadySignedError();

    await tx.delete(clinicalNotes).where(eq(clinicalNotes.id, id));

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "clinical_note",
      entityId: id,
      action: "delete",
      before,
    });
  });
}

export interface AmendNoteInput {
  body: string;
}

/**
 * POST /notes/:id/amend — signed notes are immutable, so a correction or addendum is a
 * new row pointing back at the original via amends_note_id, per docs/specs/data-model.md.
 * The new note starts unsigned — it goes through create → sign like any other note.
 */
export async function amendNote(actor: RequestActor, id: string, input: AmendNoteInput) {
  assertCan(actor.role, "clinical_notes", "write");

  return dbForRequest(actor.organizationId, async (tx) => {
    const original = await requireNote(tx, actor, id);

    const [amendment] = await tx
      .insert(clinicalNotes)
      .values({
        organizationId: actor.organizationId,
        patientId: original.patientId,
        appointmentId: original.appointmentId,
        providerId: actor.userId,
        body: input.body,
        amendsNoteId: original.id,
        createdBy: actor.userId,
      })
      .returning();

    await writeAudit(tx, { organizationId: actor.organizationId, actorUserId: actor.userId, actorIp: null }, {
      entityType: "clinical_note",
      entityId: amendment.id,
      action: "create",
      after: amendment,
    });

    return amendment;
  });
}
