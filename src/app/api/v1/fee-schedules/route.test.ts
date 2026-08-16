import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET, POST } from "./route";

const ORG_NAME = "__fee_schedules_route_test";

describe("GET /api/v1/fee-schedules", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/fee-schedules"));
    expect(res.status).toBe(401);
  });

  it("lists the org's fee schedules with snake_case fields", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    await POST(
      new NextRequest("http://localhost/api/v1/fee-schedules", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "Standard", effective_from: "2026-01-01" }),
      }),
    );

    const res = await GET(new NextRequest("http://localhost/api/v1/fee-schedules", { headers: authHeaders(token) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ name: "Standard", effective_from: "2026-01-01" });
    expect(body.data[0]).not.toHaveProperty("effectiveFrom");
  });
});

describe("POST /api/v1/fee-schedules", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("creates a fee schedule and returns 201", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/fee-schedules", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "New Schedule", effective_from: "2026-03-01" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("New Schedule");
  });

  it("403s when the actor's role can't write fee schedules", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/fee-schedules", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "Denied", effective_from: "2026-01-01" }),
      }),
    );

    expect(res.status).toBe(403);
  });
});
