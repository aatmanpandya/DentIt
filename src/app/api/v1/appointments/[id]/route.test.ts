import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, operatories, patients, providerSchedules, users } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createAppointment } from "../route";
import { GET, PATCH } from "./route";

const ORG_NAME = "__appointment_detail_route_test";
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

  return { org, token, location, opA, opB, provider, patient, appt };
}

describe("GET /api/v1/appointments/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/appointments/x"), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("404s for another org's appointment", async () => {
    const { token } = await setup();
    const res = await GET(
      new NextRequest("http://localhost/api/v1/appointments/00000000-0000-0000-0000-000000000000", { headers: authHeaders(token) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/appointments/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("moves an appointment to a new operatory/time — drag-to-move, in place", async () => {
    const { token, opB, appt } = await setup();
    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ operatory_id: opB.id, starts_at: `${DAY}T11:00:00+05:30`, ends_at: `${DAY}T11:30:00+05:30` }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(appt.id);
    expect(body.operatory_id).toBe(opB.id);
  });

  it("updates just the note without touching time or operatory", async () => {
    const { token, appt } = await setup();
    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/appointments/${appt.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ note: "Running late" }),
      }),
      { params: Promise.resolve({ id: appt.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note).toBe("Running late");
  });
});
