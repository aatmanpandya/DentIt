import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createSchedule } from "../../route";
import { POST as createCode } from "../../../procedure-codes/route";
import { GET, PUT } from "./route";

const ORG_NAME = "__fee_schedule_items_route_test";

async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
  const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

  const scheduleRes = await createSchedule(
    new NextRequest("http://localhost/api/v1/fee-schedules", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "Grid Test", effective_from: "2026-01-01" }),
    }),
  );
  const schedule = await scheduleRes.json();

  const codeRes = await createCode(
    new NextRequest("http://localhost/api/v1/procedure-codes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code: "FSI-1", short_name: "Fee item test code", category: "diagnostic", applies_to: "mouth" }),
    }),
  );
  const code = await codeRes.json();

  return { token, schedule, code };
}

describe("GET/PUT /api/v1/fee-schedules/:id/items", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/fee-schedules/x/items"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("bulk-upserts items and the grid round-trips through GET", async () => {
    const { token, schedule, code } = await setup();

    const putRes = await PUT(
      new NextRequest(`http://localhost/api/v1/fee-schedules/${schedule.id}/items`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ items: [{ procedure_code_id: code.id, price: "425.00" }] }),
      }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.data[0]).toMatchObject({ procedure_code_id: code.id, price: "425.00" });

    const getRes = await GET(
      new NextRequest(`http://localhost/api/v1/fee-schedules/${schedule.id}/items`, { headers: authHeaders(token) }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    const getBody = await getRes.json();
    expect(getBody.data).toHaveLength(1);
    expect(getBody.data[0].price).toBe("425.00");
  });

  it("404s for a fee schedule that doesn't exist", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await GET(
      new NextRequest("http://localhost/api/v1/fee-schedules/00000000-0000-0000-0000-000000000000/items", {
        headers: authHeaders(token),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(404);
  });

  it("422s a PUT with a malformed price", async () => {
    const { token, schedule, code } = await setup();

    const res = await PUT(
      new NextRequest(`http://localhost/api/v1/fee-schedules/${schedule.id}/items`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ items: [{ procedure_code_id: code.id, price: "not-a-price" }] }),
      }),
      { params: Promise.resolve({ id: schedule.id }) },
    );
    expect(res.status).toBe(422);
  });
});
