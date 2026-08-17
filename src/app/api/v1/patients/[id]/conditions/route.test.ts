import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST } from "./route";

const ORG_NAME = "__conditions_route_test";

describe("POST /api/v1/patients/:id/conditions", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/patients/x/conditions", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s for a role without odontogram write access", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [patient] = await adminDb
      .insert(patients)
      .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
      .returning();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/conditions`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ tooth: "26", condition_type: "caries" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("creates a condition", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [patient] = await adminDb
      .insert(patients)
      .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
      .returning();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/conditions`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ tooth: "26", surfaces: ["O"], condition_type: "caries" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tooth).toBe("26");
    expect(body.condition_type).toBe("caries");
    expect(body.resolved_at).toBeNull();
  });

  it("422s on a malformed body", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [patient] = await adminDb
      .insert(patients)
      .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
      .returning();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/conditions`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ tooth: "26" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
