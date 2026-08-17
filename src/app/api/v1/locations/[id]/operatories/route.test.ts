import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, operatories } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__operatories_route_test";

describe("GET /api/v1/locations/:id/operatories", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/locations/x/operatories"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("lists operatories for a location, ordered by display order", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
    await adminDb.insert(operatories).values([
      { organizationId: org.id, locationId: location.id, name: "Op 2", displayOrder: 2 },
      { organizationId: org.id, locationId: location.id, name: "Op 1", displayOrder: 1 },
    ]);

    const res = await GET(
      new NextRequest(`http://localhost/api/v1/locations/${location.id}/operatories`, { headers: authHeaders(token) }),
      { params: Promise.resolve({ id: location.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((o: { name: string }) => o.name)).toEqual(["Op 1", "Op 2"]);
  });

  it("404s for a location that doesn't exist", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(
      new NextRequest("http://localhost/api/v1/locations/00000000-0000-0000-0000-000000000000/operatories", {
        headers: authHeaders(token),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });
});
