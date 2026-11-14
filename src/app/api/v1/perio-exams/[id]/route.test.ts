import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { adminDb } from "@/server/db/client";
import { patients } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createExamRoute } from "../../patients/[id]/perio-exams/route";
import { PUT as putToothRoute } from "./teeth/[tooth]/route";
import { POST as completeRoute } from "./complete/route";
import { POST as uncompleteRoute } from "./uncomplete/route";
import { GET as compareRoute } from "./compare/route";
import { GET, PATCH } from "./route";

const ORG_NAME = "__perio_exam_route_test";

async function setup(role: "hygienist" | "admin" | "provider" = "hygienist") {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, role);
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Test", lastName: "Patient", phone: "9000000000" })
    .returning();

  const createRes = await createExamRoute(
    new NextRequest(`http://localhost/api/v1/patients/${patient.id}/perio-exams`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ exam_date: "2026-08-19" }),
    }),
    { params: Promise.resolve({ id: patient.id }) },
  );
  const exam = await createRes.json();

  return { token, patient, exam };
}

describe("GET /api/v1/perio-exams/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("returns the exam with 32 seeded tooth records", async () => {
    const { token, exam } = await setup();

    const res = await GET(new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: exam.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teeth).toHaveLength(32);
    expect(body.completed_at).toBeNull();
  });
});

describe("PATCH /api/v1/perio-exams/:id", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("updates the inline notes field", async () => {
    const { token, exam } = await setup();

    const res = await PATCH(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ notes: "Patient couldn't tolerate posterior probing." }),
      }),
      { params: Promise.resolve({ id: exam.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toBe("Patient couldn't tolerate posterior probing.");
  });
});

describe("PUT /api/v1/perio-exams/:id/teeth/:tooth", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("saves a tooth's mobility, furcation, and sites, returning the computed CAL", async () => {
    const { token, exam } = await setup();

    const res = await putToothRoute(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/teeth/16`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({
          mobility: 1,
          furcation: 2,
          sites: [{ site: "MB", pocket_depth: 4, gingival_margin: 1 }],
        }),
      }),
      { params: Promise.resolve({ id: exam.id, tooth: "16" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mobility).toBe(1);
    expect(body.sites[0].cal).toBe(5);
  });

  it("422s with PERIO_EXAM_COMPLETED once the exam is locked", async () => {
    const { token, exam } = await setup();
    await completeRoute(new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/complete`, { method: "POST", headers: authHeaders(token) }), {
      params: Promise.resolve({ id: exam.id }),
    });

    const res = await putToothRoute(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/teeth/16`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ sites: [] }),
      }),
      { params: Promise.resolve({ id: exam.id, tooth: "16" }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PERIO_EXAM_COMPLETED");
  });

  it("403s for a role with read-only perio access", async () => {
    const { token, exam } = await setup("admin");

    const res = await putToothRoute(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/teeth/16`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ sites: [] }),
      }),
      { params: Promise.resolve({ id: exam.id, tooth: "16" }) },
    );

    expect(res.status).toBe(403);
  });
});

describe("complete / uncomplete", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("completes then un-completes an exam", async () => {
    const { token, exam } = await setup();

    const completeRes = await completeRoute(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/complete`, { method: "POST", headers: authHeaders(token) }),
      { params: Promise.resolve({ id: exam.id }) },
    );
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).completed_at).not.toBeNull();

    // Reopening an approved exam needs a reason (docs/specs/perio-approval.md).
    const noReason = await uncompleteRoute(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/uncomplete`, { method: "POST", headers: authHeaders(token) }),
      { params: Promise.resolve({ id: exam.id }) },
    );
    expect(noReason.status).toBe(422);
    expect((await noReason.json()).error.code).toBe("REASON_REQUIRED");

    const uncompleteRes = await uncompleteRoute(
      new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/uncomplete`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ reason: "Wrong depth on 16 MB" }),
      }),
      { params: Promise.resolve({ id: exam.id }) },
    );
    expect(uncompleteRes.status).toBe(200);
    expect((await uncompleteRes.json()).completed_at).toBeNull();
  });
});

describe("GET /api/v1/perio-exams/:id/compare", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("returns a null baseline for a patient's first exam", async () => {
    const { token, exam } = await setup();

    const res = await compareRoute(new NextRequest(`http://localhost/api/v1/perio-exams/${exam.id}/compare`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: exam.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.against_exam_id).toBeNull();
  });
});
