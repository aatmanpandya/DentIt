import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, scheduleBlocks } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__schedule_blocks_route_test";

describe("GET /api/v1/schedule-blocks", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/schedule-blocks?from=2026-08-19&to=2026-08-19"));
    expect(res.status).toBe(401);
  });

  it("lists blocks overlapping the date range", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    await adminDb.insert(scheduleBlocks).values({
      organizationId: org.id, locationId: location.id,
      startsAt: new Date("2026-08-19T13:00:00+05:30"), endsAt: new Date("2026-08-19T14:00:00+05:30"), reason: "Lunch",
    });

    const res = await GET(
      new NextRequest("http://localhost/api/v1/schedule-blocks?from=2026-08-19&to=2026-08-19", { headers: authHeaders(token) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ reason: "Lunch" });
  });
});
