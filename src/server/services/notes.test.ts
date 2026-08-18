import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, patients } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { PatientNotFoundError } from "./patients";
import {
  createNote,
  updateNote,
  signNote,
  amendNote,
  deleteNote,
  listPatientNotes,
  NoteNotFoundError,
  NoteAlreadySignedError,
} from "./notes";

const TEST_ORG_NAME = "__notes_service_test";

async function setup(role: RequestActor["role"] = "provider") {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `notes-${Date.now()}@example.test`, fullName: "Dr Test", role })
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

describe("createNote", () => {
  afterEach(cleanup);

  it("creates an unsigned note authored by the actor", async () => {
    const { actor, patient } = await setup();

    const note = await createNote(actor, patient.id, { body: "New patient. Chief complaint: sensitivity." });

    expect(note.body).toBe("New patient. Chief complaint: sensitivity.");
    expect(note.providerId).toBe(actor.userId);
    expect(note.signedAt).toBeNull();
    expect(note.signedBy).toBeNull();
  });

  it("throws PermissionDeniedError for a role that can't write clinical notes", async () => {
    const { actor, patient } = await setup("front_desk");

    await expect(createNote(actor, patient.id, { body: "x" })).rejects.toThrow(PermissionDeniedError);
  });

  it("throws PatientNotFoundError for a patient belonging to another org", async () => {
    const { actor } = await setup();
    const [otherOrg] = await adminDb.insert(organizations).values({ name: "__notes_service_test_other" }).returning();
    const [otherPatient] = await adminDb
      .insert(patients)
      .values({ organizationId: otherOrg.id, patientNumber: "P-0001", firstName: "Other", lastName: "Org", phone: "9000000001" })
      .returning();

    await expect(createNote(actor, otherPatient.id, { body: "x" })).rejects.toThrow(PatientNotFoundError);

    await wipeOrganizationData(adminDb, otherOrg.id);
    await adminDb.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});

describe("updateNote", () => {
  afterEach(cleanup);

  it("edits an unsigned note in place", async () => {
    const { actor, patient } = await setup();
    const created = await createNote(actor, patient.id, { body: "Draft" });

    const updated = await updateNote(actor, created.id, { body: "Corrected draft" });

    expect(updated.id).toBe(created.id);
    expect(updated.body).toBe("Corrected draft");
  });

  it("rejects editing a signed note — NOTE_ALREADY_SIGNED", async () => {
    const { actor, patient } = await setup();
    const created = await createNote(actor, patient.id, { body: "Draft" });
    await signNote(actor, created.id);

    await expect(updateNote(actor, created.id, { body: "Trying to sneak an edit in" })).rejects.toThrow(NoteAlreadySignedError);
  });

  it("throws NoteNotFoundError for a note in another org", async () => {
    const { actor } = await setup();
    await expect(updateNote(actor, "00000000-0000-0000-0000-000000000000", { body: "x" })).rejects.toThrow(NoteNotFoundError);
  });
});

describe("deleteNote", () => {
  afterEach(cleanup);

  it("deletes an unsigned note", async () => {
    const { actor, patient } = await setup();
    const created = await createNote(actor, patient.id, { body: "Draft" });

    await deleteNote(actor, created.id);

    const notes = await listPatientNotes(actor, patient.id);
    expect(notes.find((n) => n.id === created.id)).toBeUndefined();
  });

  it("rejects deleting a signed note — NOTE_ALREADY_SIGNED", async () => {
    const { actor, patient } = await setup();
    const created = await createNote(actor, patient.id, { body: "Draft" });
    await signNote(actor, created.id);

    await expect(deleteNote(actor, created.id)).rejects.toThrow(NoteAlreadySignedError);
  });

  it("throws NoteNotFoundError for a note in another org", async () => {
    const { actor } = await setup();
    await expect(deleteNote(actor, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NoteNotFoundError);
  });
});

describe("signNote", () => {
  afterEach(cleanup);

  it("signs an unsigned note, stamping signed_at and signed_by", async () => {
    const { actor, patient } = await setup();
    const created = await createNote(actor, patient.id, { body: "Draft" });

    const signed = await signNote(actor, created.id);

    expect(signed.signedAt).not.toBeNull();
    expect(signed.signedBy).toBe(actor.userId);
  });

  it("rejects re-signing an already-signed note", async () => {
    const { actor, patient } = await setup();
    const created = await createNote(actor, patient.id, { body: "Draft" });
    await signNote(actor, created.id);

    await expect(signNote(actor, created.id)).rejects.toThrow(NoteAlreadySignedError);
  });

  it("throws PermissionDeniedError for a role that can't sign — e.g. assistant", async () => {
    const owner = await setup("provider");
    const created = await createNote(owner.actor, owner.patient.id, { body: "Draft" });

    const assistant = await setup("assistant");
    await expect(signNote(assistant.actor, created.id)).rejects.toThrow(PermissionDeniedError);
  });
});

describe("amendNote", () => {
  afterEach(cleanup);

  it("appends a new unsigned note pointing at the signed original, leaving the original untouched", async () => {
    const { actor, patient } = await setup();
    const original = await createNote(actor, patient.id, { body: "Original finding" });
    await signNote(actor, original.id);

    const amendment = await amendNote(actor, original.id, { body: "Addendum: follow-up needed" });

    expect(amendment.id).not.toBe(original.id);
    expect(amendment.amendsNoteId).toBe(original.id);
    expect(amendment.signedAt).toBeNull();
    expect(amendment.patientId).toBe(original.patientId);

    const notes = await listPatientNotes(actor, patient.id);
    const originalAfter = notes.find((n) => n.id === original.id);
    expect(originalAfter?.body).toBe("Original finding");
    expect(originalAfter?.signedAt).not.toBeNull();
  });
});

describe("listPatientNotes", () => {
  afterEach(cleanup);

  it("returns notes newest first", async () => {
    const { actor, patient } = await setup();
    const first = await createNote(actor, patient.id, { body: "First" });
    const second = await createNote(actor, patient.id, { body: "Second" });

    const notes = await listPatientNotes(actor, patient.id);

    expect(notes.map((n) => n.id)).toEqual([second.id, first.id]);
  });
});
