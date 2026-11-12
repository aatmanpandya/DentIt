import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { createTreatmentPlan } from "@/server/services/treatment-plans";
import { GET } from "./route";

const ORG_NAME = "__treatment_plans_route_list_test";

async function setupWithPlan() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Route", lastName: "Test", phone: "9000000000" })
    .returning();
  await createTreatmentPlan({ userId: user.id, organizationId: org.id, role: "owner" }, patient.id, { name: "Route plan" });
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  return { token, patient };
}

describe("GET /api/v1/treatment-plans", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/treatment-plans"));
    expect(res.status).toBe(401);
  });

  it("returns snake_case rows with patient, counts and total", async () => {
    const { token, patient } = await setupWithPlan();

    const res = await GET(new NextRequest("http://localhost/api/v1/treatment-plans", { headers: authHeaders(token) }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      name: "Route plan",
      status: "draft",
      patient: { id: patient.id, first_name: "Route", last_name: "Test" },
      item_count: 0,
      unpriced_count: 0,
      total: "0.00",
    });
  });

  it("filters by status and 400s on an unknown status", async () => {
    const { token } = await setupWithPlan();

    const accepted = await GET(new NextRequest("http://localhost/api/v1/treatment-plans?status=accepted", { headers: authHeaders(token) }));
    expect((await accepted.json()).data).toEqual([]);

    const bad = await GET(new NextRequest("http://localhost/api/v1/treatment-plans?status=bogus", { headers: authHeaders(token) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_FAILED");
  });
});
