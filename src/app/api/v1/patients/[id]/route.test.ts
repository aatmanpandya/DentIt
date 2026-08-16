import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST } from "../route";
import { GET, PATCH, DELETE } from "./route";

const ORG_NAME = "__patients_route_detail_test";
const BOGUS_ID = "00000000-0000-0000-0000-000000000000";

async function createPatient(token: string, overrides: Record<string, unknown> = {}) {
  const res = await POST(
    new NextRequest("http://localhost/api/v1/patients", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ first_name: "Detail", last_name: "Test", phone: "+910000000010", ...overrides }),
    }),
  );
  return res.json();
}

describe("GET /api/v1/patients/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${BOGUS_ID}`), {
      params: Promise.resolve({ id: BOGUS_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("404s for an id that doesn't exist — never 403, per docs/specs/validation-and-errors.md", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${BOGUS_ID}`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: BOGUS_ID }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns the patient serialised", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const created = await createPatient(token);

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${created.id}`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(created.id);
  });
});

describe("PATCH /api/v1/patients/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("updates the given fields and returns 200", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const created = await createPatient(token);

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/patients/${created.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ city: "Pune" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).city).toBe("Pune");
  });

  it("422s on an invalid field value", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const created = await createPatient(token);

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/patients/${created.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ sex: "not-a-real-value" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/v1/patients/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("204s for an owner and the patient then 404s on GET", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const created = await createPatient(token);

    const delRes = await DELETE(new NextRequest(`http://localhost/api/v1/patients/${created.id}`, { method: "DELETE", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(delRes.status).toBe(204);

    const getRes = await GET(new NextRequest(`http://localhost/api/v1/patients/${created.id}`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getRes.status).toBe(404);
  });

  it("403s for a front desk actor — owner/admin only per docs/specs/api-surface.md", async () => {
    const { org, user: owner } = await createTestOrgAndUser(ORG_NAME, "owner");
    const ownerToken = await tokenFor({ id: owner.id, organizationId: org.id, role: owner.role });
    const created = await createPatient(ownerToken);

    // deletePatient's role gate runs before any DB lookup (see patients.ts), so a
    // signed token is enough here — no need for a real front_desk user row to prove
    // the route maps PermissionDeniedError to 403.
    const frontDeskToken = await tokenFor({ id: owner.id, organizationId: org.id, role: "front_desk" });

    const res = await DELETE(
      new NextRequest(`http://localhost/api/v1/patients/${created.id}`, { method: "DELETE", headers: authHeaders(frontDeskToken) }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(403);
  });
});
