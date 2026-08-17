import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, operatories, providerSchedules, users } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__availability_route_test";

describe("GET /api/v1/availability", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/availability"));
    expect(res.status).toBe(401);
  });

  it("400s when a required param is missing", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(new NextRequest("http://localhost/api/v1/availability", { headers: authHeaders(token) }));
    expect(res.status).toBe(400);
  });

  it("returns candidate slots inside the provider's working hours", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    await adminDb.insert(operatories).values({ organizationId: org.id, locationId: location.id, name: "Op A" });
    const [provider] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "dr-rao@example.test", fullName: "Dr Rao", role: "provider" })
      .returning();
    // 2026-08-19 is a Wednesday.
    await adminDb.insert(providerSchedules).values({
      organizationId: org.id, providerId: provider.id, locationId: location.id,
      dayOfWeek: 3, startTime: "09:00", endTime: "10:00", effectiveFrom: "2020-01-01",
    });

    const search = new URLSearchParams({ location_id: location.id, provider_id: provider.id, date: "2026-08-19", duration: "30" });
    const res = await GET(new NextRequest(`http://localhost/api/v1/availability?${search.toString()}`, { headers: authHeaders(token) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { starts_at: "2026-08-19T03:30:00.000Z", ends_at: "2026-08-19T04:00:00.000Z" },
      { starts_at: "2026-08-19T03:45:00.000Z", ends_at: "2026-08-19T04:15:00.000Z" },
      { starts_at: "2026-08-19T04:00:00.000Z", ends_at: "2026-08-19T04:30:00.000Z" },
    ]);
  });

  it("404s for a provider that doesn't belong to this org", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();

    const search = new URLSearchParams({
      location_id: location.id, provider_id: "00000000-0000-0000-0000-000000000000", date: "2026-08-19", duration: "30",
    });
    const res = await GET(new NextRequest(`http://localhost/api/v1/availability?${search.toString()}`, { headers: authHeaders(token) }));
    expect(res.status).toBe(404);
  });
});
