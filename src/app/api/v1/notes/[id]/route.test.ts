import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createNoteRoute } from "../../patients/[id]/notes/route";
import { POST as signNoteRoute } from "./sign/route";
import { PATCH, DELETE } from "./route";

const ORG_NAME = "__note_route_test";

async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();

  const createRes = await createNoteRoute(
    new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ body: "Draft note." }),
    }),
    { params: Promise.resolve({ id: patient.id }) },
  );
  const note = await createRes.json();

  return { token, patient, note };
}

describe("PATCH /api/v1/notes/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("edits an unsigned note", async () => {
    const { token, note } = await setup();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/notes/${note.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "Corrected draft." }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body).toBe("Corrected draft.");
  });

  it("422s with NOTE_ALREADY_SIGNED when editing a signed note", async () => {
    const { token, note } = await setup();
    await signNoteRoute(new NextRequest(`http://localhost/api/v1/notes/${note.id}/sign`, { method: "POST", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: note.id }),
    });

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/notes/${note.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "Trying to sneak an edit in." }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NOTE_ALREADY_SIGNED");
  });
});

describe("DELETE /api/v1/notes/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("deletes an unsigned note", async () => {
    const { token, note } = await setup();

    const res = await DELETE(new NextRequest(`http://localhost/api/v1/notes/${note.id}`, { method: "DELETE", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: note.id }),
    });

    expect(res.status).toBe(204);
  });

  it("422s with NOTE_ALREADY_SIGNED when deleting a signed note", async () => {
    const { token, note } = await setup();
    await signNoteRoute(new NextRequest(`http://localhost/api/v1/notes/${note.id}/sign`, { method: "POST", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: note.id }),
    });

    const res = await DELETE(new NextRequest(`http://localhost/api/v1/notes/${note.id}`, { method: "DELETE", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: note.id }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NOTE_ALREADY_SIGNED");
  });
});
