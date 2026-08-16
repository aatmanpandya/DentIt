import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createPatientRoute } from "../../patients/route";
import { POST as createAlertRoute } from "../../patients/[id]/alerts/route";
import { PATCH } from "./route";

const ORG_NAME = "__alerts_route_test";
const BOGUS_ID = "00000000-0000-0000-0000-000000000000";

async function createPatientWithAlert(token: string) {
  const patient = await createPatientRoute(
    new NextRequest("http://localhost/api/v1/patients", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ first_name: "Alert", last_name: "Owner", phone: "+910000000040" }),
    }),
  ).then((r) => r.json());

  const alert = await createAlertRoute(
    new NextRequest(`http://localhost/api/v1/patients/${patient.id}/alerts`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ alert_type: "precaution", label: "Nervous patient" }),
    }),
    { params: Promise.resolve({ id: patient.id }) },
  ).then((r) => r.json());

  return { patient, alert };
}

describe("PATCH /api/v1/alerts/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await PATCH(new NextRequest(`http://localhost/api/v1/alerts/${BOGUS_ID}`, { method: "PATCH", body: "{}" }), {
      params: Promise.resolve({ id: BOGUS_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("404s for an alert that doesn't exist", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/alerts/${BOGUS_ID}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ is_active: false }),
      }),
      { params: Promise.resolve({ id: BOGUS_ID }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("deactivates an alert and returns it serialised", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const { alert } = await createPatientWithAlert(token);

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/alerts/${alert.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ is_active: false }),
      }),
      { params: Promise.resolve({ id: alert.id }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).is_active).toBe(false);
  });
});
