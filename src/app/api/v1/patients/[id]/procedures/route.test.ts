import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients, procedureCodes } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST } from "./route";

const ORG_NAME = "__procedures_route_test";

async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();
  const [code] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "EXT-TEST", shortName: "Test extraction", category: "oral_surgery", appliesTo: "tooth" })
    .returning();
  return { token, patient, code };
}

describe("POST /api/v1/patients/:id/procedures", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/patients/x/procedures", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates a planned procedure with no price", async () => {
    const { token, patient, code } = await setup();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/procedures`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ procedure_code_id: code.id, tooth: "26" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("planned");
    expect(body.price).toBeNull();
  });

  it("422s with PROCEDURE_SCOPE_MISMATCH for a tooth-scoped code posted with surfaces", async () => {
    const { token, patient, code } = await setup();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/procedures`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ procedure_code_id: code.id, tooth: "26", surfaces: ["O"] }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PROCEDURE_SCOPE_MISMATCH");
  });
});
