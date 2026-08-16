import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET, POST } from "./route";

const ORG_NAME = "__patients_route_list_create_test";

describe("GET /api/v1/patients", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const req = new NextRequest("http://localhost/api/v1/patients");
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_TOKEN_EXPIRED");
  });

  it("returns the list envelope with snake_case fields", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    await POST(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "Route", last_name: "Test", phone: "+910000000001" }),
      }),
    );

    const res = await GET(new NextRequest("http://localhost/api/v1/patients", { headers: authHeaders(token) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("next_cursor");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ first_name: "Route", last_name: "Test", phone: "+910000000001" });
    expect(body.data[0]).not.toHaveProperty("firstName");
  });

  it("passes q through to the search", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    await POST(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "Findme", last_name: "Unique", phone: "+910000000002" }),
      }),
    );
    await POST(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "Other", last_name: "Person", phone: "+910000000003" }),
      }),
    );

    const res = await GET(new NextRequest("http://localhost/api/v1/patients?q=Findme", { headers: authHeaders(token) }));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].first_name).toBe("Findme");
  });
});

describe("POST /api/v1/patients", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("creates a patient and returns 201 with the full serialised object", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "New", last_name: "Patient", phone: "+910000000004" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.patient_number).toMatch(/^P-\d{4,}$/);
    expect(body.is_active).toBe(true);
  });

  it("422s with field-level details when required fields are missing", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "OnlyFirstName" }),
      }),
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.some((d: { path: string[] }) => d.path.includes("phone"))).toBe(true);
  });

  it("403s when the actor's role can't write patients", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "accountant");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "A", last_name: "B", phone: "+910000000005" }),
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PERMISSION_DENIED");
  });
});
