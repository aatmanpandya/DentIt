import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, operatories, patients, providerSchedules, users } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createAppointment } from "../../route";
import { GET as getAppointment } from "../route";
import { POST } from "./route";

const ORG_NAME = "__appointment_reschedule_route_test";
const DAY = "2026-08-19";

async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "front_desk");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

  const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
  const [opA] = await adminDb.insert(operatories).values({ organizationId: org.id, locationId: location.id, name: "Op A" }).returning();
  const [opB] = await adminDb.insert(operatories).values({ organizationId: org.id, locationId: location.id, name: "Op B" }).returning();
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
        patient_id: patient.id, location_id: location.id, operatory_id: opA.id, provider_id: provider.id,
        starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`,
      }),
    }),
  );
  const appt = await apptRes.json();

  return { token, opB, appt };
}

describe("POST /api/v1/appointments/:id/reschedule", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/appointments/x/reschedule", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates a new appointment and cancels the original, linked by rescheduled_to_id", async () => {
    const { token, opB, appt } = await setup();

    const res = await POST(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}/reschedule`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ operatory_id: opB.id, starts_at: `${DAY}T14:00:00+05:30`, ends_at: `${DAY}T14:30:00+05:30` }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(201);
    const rescheduled = await res.json();
    expect(rescheduled.id).not.toBe(appt.id);
    expect(rescheduled.status).toBe("scheduled");

    const originalRes = await getAppointment(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}`, { headers: authHeaders(token) }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    const original = await originalRes.json();
    expect(original.status).toBe("cancelled");
    expect(original.rescheduled_to_id).toBe(rescheduled.id);
  });
});
