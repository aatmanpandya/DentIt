import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__locations_route_test";

describe("GET /api/v1/locations", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/locations"));
    expect(res.status).toBe(401);
  });

  it("front desk can list locations — no RBAC gate on structural reference data", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    await adminDb.insert(locations).values({ organizationId: org.id, name: "Main Clinic" });

    const res = await GET(new NextRequest("http://localhost/api/v1/locations", { headers: authHeaders(token) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ name: "Main Clinic" });
    expect(body.data[0]).not.toHaveProperty("organizationId");
  });
});
