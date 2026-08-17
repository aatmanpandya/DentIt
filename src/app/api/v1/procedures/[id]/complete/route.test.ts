import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients, procedureCodes } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { createProcedure, updateProcedureStatus } from "@/server/services/chart";
import type { RequestActor } from "@/server/lib/request-auth";
import { POST } from "./route";

const ORG_NAME = "__procedure_complete_route_test";

describe("POST /api/v1/procedures/:id/complete", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/procedures/x/complete", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("marks a scheduled procedure completed", async () => {
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
    let procedure = await createProcedure(actor, patient.id, { procedure_code_id: code.id, tooth: "26" });
    procedure = await updateProcedureStatus(actor, procedure.id, "accepted");
    procedure = await updateProcedureStatus(actor, procedure.id, "scheduled");

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/procedures/${procedure.id}/complete`, { method: "POST", headers: authHeaders(token) }),
      { params: Promise.resolve({ id: procedure.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.completed_at).not.toBeNull();
  });
});
