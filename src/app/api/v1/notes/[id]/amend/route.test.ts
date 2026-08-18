import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createNoteRoute } from "../../../patients/[id]/notes/route";
import { POST as signNoteRoute } from "../sign/route";
import { POST } from "./route";

const ORG_NAME = "__note_amend_route_test";

describe("POST /api/v1/notes/:id/amend", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("creates a new unsigned note pointing back at the signed original", async () => {
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
        body: JSON.stringify({ body: "Original finding." }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );
    const note = await createRes.json();
    await signNoteRoute(new NextRequest(`http://localhost/api/v1/notes/${note.id}/sign`, { method: "POST", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: note.id }),
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/notes/${note.id}/amend`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "Addendum: follow-up needed." }),
      }),
      { params: Promise.resolve({ id: note.id }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.amends_note_id).toBe(note.id);
    expect(body.signed_at).toBeNull();
  });
});
