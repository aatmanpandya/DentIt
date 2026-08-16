import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { POST as createSchedule } from "../fee-schedules/route";
import { PUT as putItems } from "../fee-schedules/[id]/items/route";
import { POST as createCode } from "../procedure-codes/route";
import { GET } from "./route";

const ORG_NAME = "__pricing_route_test";

describe("GET /api/v1/pricing", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/pricing?procedure_code_id=x"));
    expect(res.status).toBe(401);
  });

  it("resolves the price from the org's default fee schedule", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const codeRes = await createCode(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "PRICE-1", short_name: "Priced", category: "diagnostic", applies_to: "mouth" }),
      }),
    );
    const code = await codeRes.json();

    const scheduleRes = await createSchedule(
      new NextRequest("http://localhost/api/v1/fee-schedules", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "Default", effective_from: "2026-01-01", is_default: true }),
      }),
    );
    const schedule = await scheduleRes.json();

    await putItems(
      new NextRequest(`http://localhost/api/v1/fee-schedules/${schedule.id}/items`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ items: [{ procedure_code_id: code.id, price: "600.00" }] }),
      }),
      { params: Promise.resolve({ id: schedule.id }) },
    );

    const res = await GET(
      new NextRequest(`http://localhost/api/v1/pricing?procedure_code_id=${code.id}&on_date=2026-06-01`, {
        headers: authHeaders(token),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.price).toBe("600.00");
  });

  it("422s when nothing is priced yet", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const codeRes = await createCode(
      new NextRequest("http://localhost/api/v1/procedure-codes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ code: "PRICE-2", short_name: "Unpriced", category: "diagnostic", applies_to: "mouth" }),
      }),
    );
    const code = await codeRes.json();

    const res = await GET(
      new NextRequest(`http://localhost/api/v1/pricing?procedure_code_id=${code.id}`, { headers: authHeaders(token) }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("FEE_SCHEDULE_NO_PRICE");
  });
});
