import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { locations, operatories, patients, providerSchedules, users } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET, POST } from "./route";

const ORG_NAME = "__appointments_route_test";
const DAY = "2026-08-19"; // a Wednesday

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

  return { org, user, token, location, operatory, provider, patient };
}

describe("GET /api/v1/appointments", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/appointments"));
    expect(res.status).toBe(401);
  });

  it("lists appointments for a location on a date, snake_case fields", async () => {
    const { token, location, operatory, provider, patient } = await setup();
    await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
          starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`,
        }),
      }),
    );

    const res = await GET(
      new NextRequest(`http://localhost/api/v1/appointments?location_id=${location.id}&date=${DAY}`, { headers: authHeaders(token) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ operatory_id: operatory.id, status: "scheduled" });
    expect(body.data[0]).not.toHaveProperty("operatoryId");
  });

  it("400s when neither date nor from/to is provided", async () => {
    const { token, location } = await setup();
    const res = await GET(
      new NextRequest(`http://localhost/api/v1/appointments?location_id=${location.id}`, { headers: authHeaders(token) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/appointments", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("books an appointment and returns 201", async () => {
    const { token, location, operatory, provider, patient } = await setup();
    const res = await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
          starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("scheduled");
  });

  it("403s when the actor's role can't write appointments", async () => {
    const { org, location, operatory, provider, patient } = await setup();
    const { user: accountantUser } = await createTestOrgAndUserInOrg(org.id, "accountant");
    const token = await tokenFor({ id: accountantUser.id, organizationId: org.id, role: "accountant" });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
          starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("409s on a double-booked operatory", async () => {
    const { token, location, operatory, provider, patient } = await setup();
    await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
          starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30`,
        }),
      }),
    );

    const res = await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
          starts_at: `${DAY}T10:15:00+05:30`, ends_at: `${DAY}T10:45:00+05:30`, override: true,
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("APPOINTMENT_CONFLICT");
  });

  it("422s outside provider hours, naming the code", async () => {
    const { token, location, operatory, provider, patient } = await setup();
    const res = await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          patient_id: patient.id, location_id: location.id, operatory_id: operatory.id, provider_id: provider.id,
          starts_at: `${DAY}T20:00:00+05:30`, ends_at: `${DAY}T20:30:00+05:30`,
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("APPOINTMENT_OUTSIDE_HOURS");
  });

  it("422s a malformed body", async () => {
    const { token } = await setup();
    const res = await POST(
      new NextRequest("http://localhost/api/v1/appointments", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ patient_id: "not-a-uuid" }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

async function createTestOrgAndUserInOrg(organizationId: string, role: "accountant") {
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId, email: `accountant-${Date.now()}@example.test`, fullName: "Accountant", role })
    .returning();
  return { user };
}
