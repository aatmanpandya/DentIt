import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients, chartedConditions } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { PATCH } from "./route";

const ORG_NAME = "__condition_route_test";

describe("PATCH /api/v1/conditions/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await PATCH(new NextRequest("http://localhost/api/v1/conditions/x", { method: "PATCH" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("resolves a condition", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [patient] = await adminDb
      .insert(patients)
      .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
      .returning();
    const [condition] = await adminDb
      .insert(chartedConditions)
      .values({ organizationId: org.id, patientId: patient.id, tooth: "26", conditionType: "caries", chartedBy: user.id })
      .returning();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/conditions/${condition.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ resolve: true }),
      }),
      { params: Promise.resolve({ id: condition.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolved_at).not.toBeNull();
  });

  it("404s for a condition that doesn't exist", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await PATCH(
      new NextRequest("http://localhost/api/v1/conditions/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ resolve: true }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });
});
