import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients, procedureCodes } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { createProcedure } from "@/server/services/chart";
import type { RequestActor } from "@/server/lib/request-auth";
import { PATCH, DELETE } from "./route";

const ORG_NAME = "__procedure_route_test";

async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "provider");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role: "provider" };
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();
  const [code] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "EXT-TEST", shortName: "Test extraction", category: "oral_surgery", appliesTo: "tooth" })
    .returning();
  const procedure = await createProcedure(actor, patient.id, { procedure_code_id: code.id, tooth: "26" });
  return { token, procedure };
}

describe("PATCH /api/v1/procedures/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await PATCH(new NextRequest("http://localhost/api/v1/procedures/x", { method: "PATCH" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("transitions status when the body has to_status", async () => {
    const { token, procedure } = await setup();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "accepted" }),
      }),
      { params: Promise.resolve({ id: procedure.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });

  it("422s with PROCEDURE_ILLEGAL_TRANSITION for an illegal status change", async () => {
    const { token, procedure } = await setup();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "invoiced" }),
      }),
      { params: Promise.resolve({ id: procedure.id }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PROCEDURE_ILLEGAL_TRANSITION");
  });

  it("amends content when the body has no to_status", async () => {
    const { token, procedure } = await setup();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ note: "Updated note" }),
      }),
      { params: Promise.resolve({ id: procedure.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(procedure.id);
    expect(body.note).toBe("Updated note");
  });
});

describe("DELETE /api/v1/procedures/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("deletes a planned procedure", async () => {
    const { token, procedure } = await setup();

    const res = await DELETE(new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}`, { method: "DELETE", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: procedure.id }),
    });

    expect(res.status).toBe(204);
  });

  it("422s with PROCEDURE_NOT_DELETABLE for an accepted procedure", async () => {
    const { token, procedure } = await setup();
    await PATCH(
      new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "accepted" }),
      }),
      { params: Promise.resolve({ id: procedure.id }) },
    );

    const res = await DELETE(new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}`, { method: "DELETE", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: procedure.id }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PROCEDURE_NOT_DELETABLE");
  });
});
