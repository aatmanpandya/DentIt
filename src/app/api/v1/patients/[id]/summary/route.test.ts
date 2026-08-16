import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createPatientRoute } from "../../route";
import { GET } from "./route";

const ORG_NAME = "__patients_route_summary_test";
const BOGUS_ID = "00000000-0000-0000-0000-000000000000";

describe("GET /api/v1/patients/:id/summary", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${BOGUS_ID}/summary`), {
      params: Promise.resolve({ id: BOGUS_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("404s for a patient that doesn't exist", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${BOGUS_ID}/summary`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: BOGUS_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the one-request chart header shape for a brand new patient", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const created = await createPatientRoute(
      new NextRequest("http://localhost/api/v1/patients", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ first_name: "Summary", last_name: "Test", phone: "+910000000020" }),
      }),
    ).then((r) => r.json());

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${created.id}/summary`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: created.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ alerts: [], next_appointment: null, last_visit_at: null, balance: "0.00" });
  });
});
