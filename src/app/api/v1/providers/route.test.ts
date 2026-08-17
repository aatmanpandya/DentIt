import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { users, providerProfiles } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "./route";

const ORG_NAME = "__providers_route_test";

describe("GET /api/v1/providers", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/providers"));
    expect(res.status).toBe(401);
  });

  it("lists users with a provider_profiles row, excluding those without one", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const [dentist] = await adminDb
      .insert(users)
      .values({ organizationId: org.id, email: "dr-rao@example.test", fullName: "Dr Rao", role: "provider" })
      .returning();
    await adminDb.insert(providerProfiles).values({ organizationId: org.id, userId: dentist.id });

    const res = await GET(new NextRequest("http://localhost/api/v1/providers", { headers: authHeaders(token) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((p: { full_name: string }) => p.full_name)).toEqual(["Dr Rao"]);
  });
});
