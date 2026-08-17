import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, providerSchedules } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__provider_schedule_route_test";

describe("GET /api/v1/providers/:id/schedule", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/providers/x/schedule"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("lists a provider's schedule, ordered by day of week", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    await adminDb.insert(providerSchedules).values([
      { organizationId: org.id, providerId: user.id, locationId: location.id, dayOfWeek: 2, startTime: "09:00", endTime: "17:00", effectiveFrom: "2020-01-01" },
      { organizationId: org.id, providerId: user.id, locationId: location.id, dayOfWeek: 1, startTime: "09:00", endTime: "17:00", effectiveFrom: "2020-01-01" },
    ]);

    const res = await GET(
      new NextRequest(`http://localhost/api/v1/providers/${user.id}/schedule?location_id=${location.id}`, {
        headers: authHeaders(token),
      }),
      { params: Promise.resolve({ id: user.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((r: { day_of_week: number }) => r.day_of_week)).toEqual([1, 2]);
  });

  it("404s for a provider in another org", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(
      new NextRequest("http://localhost/api/v1/providers/00000000-0000-0000-0000-000000000000/schedule", {
        headers: authHeaders(token),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });
});
