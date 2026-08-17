import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, operatories, patients, providerSchedules, users } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createAppointment } from "../../route";
import { POST } from "./route";

const ORG_NAME = "__appointment_transition_route_test";
const DAY = "2026-08-19";

async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

  const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
  const [operatory] = await adminDb.insert(operatories).values({ organizationId: org.id, locationId: location.id, name: "Op A" }).returning();
  const [provider] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: "dr-rao@example.test", fullName: "Dr Rao", role: "provider" })
    .returning();
  for (let day = 0; day <= 6; day++) {
    await adminDb.insert(providerSchedules).values({
      organizationId: org.id, providerId: provider.id, locationId: location.id,
      dayOfWeek: day, startTime: "09:00", endTime: "17:00", effectiveFrom: "2020-01-01",
    });
  }
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Priya", lastName: "Sharma", phone: "9000000000" })
    .returning();

  const apptRes = await createAppointment(
    new NextRequest("http://localhost/api/v1/appointments", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
        starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`,
      }),
    }),
  );
  const appt = await apptRes.json();

  return { token, appt };
}

describe("POST /api/v1/appointments/:id/transition", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/appointments/x/transition", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("confirms a scheduled appointment", async () => {
    const { token, appt } = await setup();
    const res = await POST(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}/transition`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "confirmed" }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("confirmed");
  });

  it("422s an illegal transition, naming the code", async () => {
    const { token, appt } = await setup();
    const res = await POST(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}/transition`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "completed" }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("APPOINTMENT_ILLEGAL_TRANSITION");
  });

  it("422s cancelling without a reason and cancelled_by", async () => {
    const { token, appt } = await setup();
    const res = await POST(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}/transition`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "cancelled" }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(422);
  });

  it("cancels with a reason and cancelled_by", async () => {
    const { token, appt } = await setup();
    const res = await POST(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}/transition`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: "cancelled", reason: "Patient called in sick", cancelled_by: "patient" }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "cancelled", cancelled_by: "patient", cancellation_reason: "Patient called in sick" });
  });
});
