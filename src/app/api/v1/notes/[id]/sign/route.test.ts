import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createNoteRoute } from "../../../patients/[id]/notes/route";
import { POST } from "./route";

const ORG_NAME = "__note_sign_route_test";

async function setup(role: "provider" | "assistant" = "provider") {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, role);
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();
  return { token, patient };
}

describe("POST /api/v1/notes/:id/sign", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("signs an unsigned note", async () => {
    const { token, patient } = await setup();
    const createRes = await createNoteRoute(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "Draft note." }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );
    const note = await createRes.json();

    const res = await POST(new NextRequest(`http://localhost/api/v1/notes/${note.id}/sign`, { method: "POST", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: note.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signed_at).not.toBeNull();
    expect(body.signed_by).toBeTruthy();
  });

  it("403s with PERMISSION_DENIED for a role that can't sign — assistant", async () => {
    const provider = await setup("provider");
    const createRes = await createNoteRoute(
      new NextRequest(`http://localhost/api/v1/patients/${provider.patient.id}/notes`, {
        method: "POST",
        headers: authHeaders(provider.token),
        body: JSON.stringify({ body: "Draft note." }),
      }),
      { params: Promise.resolve({ id: provider.patient.id }) },
    );
    const note = await createRes.json();

    const assistant = await setup("assistant");
    const res = await POST(
      new NextRequest(`http://localhost/api/v1/notes/${note.id}/sign`, { method: "POST", headers: authHeaders(assistant.token) }),
      { params: Promise.resolve({ id: note.id }) },
    );

    expect(res.status).toBe(403);
  });
});
