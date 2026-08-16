import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createCode } from "../route";
import { PATCH } from "./route";

const ORG_NAME = "__procedure_codes_route_id_test";

async function createOwnerAndCode(codeValue = "RT-ID-1") {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const created = await createCode(
    new NextRequest("http://localhost/api/v1/procedure-codes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code: codeValue, short_name: "Before", category: "diagnostic", applies_to: "mouth" }),
    }),
  );
  const code = await created.json();
  return { org, user, token, code };
}

describe("PATCH /api/v1/procedure-codes/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const req = new NextRequest("http://localhost/api/v1/procedure-codes/x", { method: "PATCH", body: "{}" });
    const res = await PATCH(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("updates the given fields and returns 200", async () => {
    const { token, code } = await createOwnerAndCode();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/procedure-codes/${code.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ short_name: "After", is_active: false }),
      }),
      { params: Promise.resolve({ id: code.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.short_name).toBe("After");
    expect(body.is_active).toBe(false);
  });

  it("404s for a nonexistent id", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await PATCH(
      new NextRequest("http://localhost/api/v1/procedure-codes/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ short_name: "Nope" }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("403s when the actor's role can't write the catalog", async () => {
    const { code } = await createOwnerAndCode("RT-ID-2");
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/procedure-codes/${code.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ short_name: "Denied" }),
      }),
      { params: Promise.resolve({ id: code.id }) },
    );

    expect(res.status).toBe(403);
  });
});
