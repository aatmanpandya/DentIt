import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { chartedProcedures, locations, patients, procedureCodes } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { createProcedure, updateProcedureStatus } from "@/server/services/chart";
import { POST as createInvoiceRoute } from "./route";
import { GET as getInvoiceRoute } from "./[id]/route";
import { POST as voidRoute } from "./[id]/void/route";
import { POST as paymentRoute } from "../payments/route";
import { GET as patientLedgerRoute } from "../patients/[id]/ledger/route";

const ORG_NAME = "__ledger_routes_test";

/**
 * Route-layer tests for the ledger: auth wiring, validation, status codes, snake_case,
 * the Idempotency-Key header. Business rules are covered in services/ledger.test.ts.
 */
async function setup() {
  const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
  const actor = { userId: user.id, organizationId: org.id, role: "owner" as const };
  const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Route", lastName: "Ledger", phone: "9000000000" })
    .returning();
  const [code] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: org.id, code: "FILL", shortName: "Filling", category: "restorative", appliesTo: "tooth" })
    .returning();
  const created = await createProcedure(actor, patient.id, { procedure_code_id: code.id, tooth: "36" });
  await updateProcedureStatus(actor, created.id, "completed");
  await adminDb.update(chartedProcedures).set({ price: "1500.00" }).where(eq(chartedProcedures.id, created.id));

  const token = await tokenFor({ id: user.id, organizationId: org.id, role: "owner" });
  return { token, location, patient, procedureId: created.id };
}

const json = (url: string, token: string, body: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(url, { method: "POST", headers: { ...authHeaders(token), ...extra }, body: JSON.stringify(body) });

describe("ledger routes", () => {
  afterEach(() => cleanupOrgsByName(ORG_NAME));

  it("401s without a token", async () => {
    const res = await createInvoiceRoute(new NextRequest("http://localhost/api/v1/invoices", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("creates an invoice (201, snake_case) and 422s on a bad body", async () => {
    const { token, location, patient, procedureId } = await setup();

    const bad = await createInvoiceRoute(json("http://localhost/api/v1/invoices", token, { patient_id: patient.id }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.code).toBe("VALIDATION_FAILED");

    const res = await createInvoiceRoute(
      json("http://localhost/api/v1/invoices", token, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [procedureId] }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: "issued", total: "1500.00", tax_total: "0.00" });
    expect(body.invoice_number).toMatch(/^INV-\d{4}-0001$/);
    expect(body.lines[0]).toMatchObject({ description: "Filling · 36", line_total: "1500.00" });
    expect(body).not.toHaveProperty("invoiceNumber");

    const detail = await getInvoiceRoute(new NextRequest(`http://localhost/api/v1/invoices/${body.id}`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: body.id }),
    });
    expect((await detail.json()).location.name).toBe("Main");
  });

  it("replays a payment with the same Idempotency-Key: 201 then 200, one payment", async () => {
    const { token, location, patient } = await setup();
    const body = { patient_id: patient.id, location_id: location.id, amount: "500.00", method: "upi" };

    const first = await paymentRoute(json("http://localhost/api/v1/payments", token, body, { "Idempotency-Key": "abc" }));
    const second = await paymentRoute(json("http://localhost/api/v1/payments", token, body, { "Idempotency-Key": "abc" }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe((await first.json()).id);

    const reused = await paymentRoute(json("http://localhost/api/v1/payments", token, { ...body, amount: "1.00" }, { "Idempotency-Key": "abc" }));
    expect(reused.status).toBe(422);
    expect((await reused.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const ledger = await patientLedgerRoute(new NextRequest(`http://localhost/api/v1/patients/${patient.id}/ledger`, { headers: authHeaders(token) }), {
      params: Promise.resolve({ id: patient.id }),
    });
    expect((await ledger.json()).credit).toBe("500.00");
  });

  it("maps void errors: 404 for an unknown invoice, 422 for a missing reason", async () => {
    const owner = await setup();
    const created = await createInvoiceRoute(
      json("http://localhost/api/v1/invoices", owner.token, { patient_id: owner.patient.id, location_id: owner.location.id, charted_procedure_ids: [owner.procedureId] }),
    );
    const invoiceId = (await created.json()).id;
    const ctx = { params: Promise.resolve({ id: invoiceId }) };

    const noReason = await voidRoute(json(`http://localhost/api/v1/invoices/${invoiceId}/void`, owner.token, {}), ctx);
    expect(noReason.status).toBe(422);

    const unknown = await voidRoute(json("http://localhost/api/v1/invoices/x/void", owner.token, { reason: "x" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(unknown.status).toBe(404);

    const ok = await voidRoute(json(`http://localhost/api/v1/invoices/${invoiceId}/void`, owner.token, { reason: "Wrong tooth" }), ctx);
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("void");
  });
});
