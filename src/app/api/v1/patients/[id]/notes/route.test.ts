import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET, POST } from "./route";

const ORG_NAME = "__notes_route_test";

async function setup(role: "provider" | "front_desk" = "provider") {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, role);
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();
  return { token, patient };
}

describe("POST /api/v1/patients/:id/notes", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/patients/x/notes", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates an unsigned note", async () => {
    const { token, patient } = await setup();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "Chief complaint: sensitivity upper left on cold." }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.body).toBe("Chief complaint: sensitivity upper left on cold.");
    expect(body.signed_at).toBeNull();
  });

  it("422s with VALIDATION_FAILED for an empty body", async () => {
    const { token, patient } = await setup();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("403s with PERMISSION_DENIED for front desk", async () => {
    const { token, patient } = await setup("front_desk");

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "Should not be allowed." }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("GET /api/v1/patients/:id/notes", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("lists notes for the patient", async () => {
    const { token, patient } = await setup();
    await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ body: "First note." }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${patient.id}/notes`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: patient.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].body).toBe("First note.");
  });
});
