import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET, POST } from "./route";

const ORG_NAME = "__procedure_codes_route_list_create_test";

describe("GET /api/v1/procedure-codes", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const req = new NextRequest("http://localhost/api/v1/procedure-codes");
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_TOKEN_EXPIRED");
  });

  it("returns the list envelope with snake_case fields", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-1", short_name: "Route Test Code", category: "diagnostic", applies_to: "mouth" }),
      }),
    );

    const res = await GET(new NextRequest("http://localhost/api/v1/procedure-codes", { headers: authHeaders(token) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("next_cursor");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ code: "RT-1", short_name: "Route Test Code", applies_to: "mouth" });
    expect(body.data[0]).not.toHaveProperty("shortName");
  });

  it("filters by category", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-DIAG", short_name: "Diag", category: "diagnostic", applies_to: "mouth" }),
      }),
    );
    await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-PREV", short_name: "Prev", category: "preventive", applies_to: "mouth" }),
      }),
    );

    const res = await GET(
      new NextRequest("http://localhost/api/v1/procedure-codes?category=preventive", { headers: authHeaders(token) }),
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].code).toBe("RT-PREV");
  });
});

describe("POST /api/v1/procedure-codes", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("creates a procedure code and returns 201 with the full serialised object", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-NEW", short_name: "New code", category: "restorative", applies_to: "surface" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe("RT-NEW");
    expect(body.is_active).toBe(true);
    expect(body.tax_class).toBe("exempt_healthcare");
  });

  it("422s with field-level details when required fields are missing", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-BAD" }),
      }),
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.some((d: { path: string[] }) => d.path.includes("category"))).toBe(true);
  });

  it("403s when the actor's role can't write the catalog", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-DENY", short_name: "Denied", category: "diagnostic", applies_to: "mouth" }),
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("409s on a duplicate code within the same org", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-DUP", short_name: "First", category: "diagnostic", applies_to: "mouth" }),
      }),
    );
    const res = await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "RT-DUP", short_name: "Second", category: "diagnostic", applies_to: "mouth" }),
      }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DUPLICATE_PROCEDURE_CODE");
  });
});
