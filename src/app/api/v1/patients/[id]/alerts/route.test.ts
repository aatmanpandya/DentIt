import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createPatientRoute } from "../../route";
import { GET, POST } from "./route";

const ORG_NAME = "__patients_route_alerts_test";

async function createPatient(token: string) {
  return createPatientRoute(
    new NextRequest("http://localhost/api/v1/patients", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ first_name: "Alerts", last_name: "Test", phone: "+910000000030" }),
    }),
  ).then((r) => r.json());
}

describe("POST /api/v1/patients/:id/alerts", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/patients/x/alerts", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates an alert and returns 201 serialised", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const patient = await createPatient(token);

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/alerts`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ alert_type: "allergy", label: "Penicillin", severity: "critical" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ patient_id: patient.id, alert_type: "allergy", label: "Penicillin", severity: "critical", is_active: true });
  });

  it("422s on an invalid alert_type", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const patient = await createPatient(token);

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/alerts`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ alert_type: "not-a-real-type", label: "X" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/patients/:id/alerts", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("lists alerts for the patient under { data }", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME);
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
    const patient = await createPatient(token);

    await POST(
      new NextRequest(`http://localhost/api/v1/patients/${patient.id}/alerts`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ alert_type: "medical", label: "Diabetes" }),
      }),
      { params: Promise.resolve({ id: patient.id }) },
    );

    const res = await GET(new NextRequest(`http://localhost/api/v1/patients/${patient.id}/alerts`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: patient.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].label).toBe("Diabetes");
  });
});
