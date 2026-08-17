import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients, chartedConditions } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__chart_route_test";

describe("GET /api/v1/patients/:id/chart", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/patients/x/chart"), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("returns conditions and procedures for the patient, snake_case", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [patient] = await adminDb
      .insert(patients)
      .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
      .returning();
    await adminDb.insert(chartedConditions).values({
      organizationId: org.id,
      patientId: patient.id,
      tooth: "26",
      conditionType: "caries",
      chartedBy: user.id,
    });

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${patient.id}/chart`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: patient.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conditions).toHaveLength(1);
    expect(body.conditions[0].condition_type).toBe("caries");
    expect(body.procedures).toEqual([]);
  });

  it("404s for a patient that doesn't exist", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(
      new NextRequest("http://localhost/api/v1/patients/00000000-0000-0000-0000-000000000000/chart", { headers: authHeaders(token) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );

    expect(res.status).toBe(404);
  });
});
