import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, patients, procedureCodes, locations, chartedProcedures, invoices, payments } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { createProcedure, updateProcedureStatus } from "./chart";
import { createFeeSchedule, upsertFeeScheduleItems } from "./catalog";
import {
  createInvoice,
  voidInvoice,
  recordPayment,
  applyCredit,
  createAdjustment,
  getInvoice,
  getPatientLedger,
  getOrganizationLedger,
  listInvoiceableProcedures,
  suggestInvoiceLocation,
  InvoiceNotFoundError,
  InvoiceAlreadyVoidError,
  ProcedureNotInvoiceableError,
  PaymentExceedsBalanceError,
  IdempotencyKeyReusedError,
  AdjustmentInvalidError,
  ChargeReductionNotAllowedError,
  reversePayment,
  PaymentNotFoundError,
  PaymentAlreadyReversedError,
} from "./ledger";

const TEST_ORG_NAME = "__ledger_service_test";

async function makeUser(orgId: string, role: RequestActor["role"]): Promise<RequestActor> {
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: orgId, email: `ledger-${role}-${Math.random().toString(36).slice(2)}@example.test`, fullName: `Test ${role}`, role })
    .returning();
  return { userId: user.id, organizationId: orgId, role };
}

async function setup(opts: { gstRegistered?: boolean; pricesIncludeTax?: boolean } = {}) {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: TEST_ORG_NAME, gstRegistered: opts.gstRegistered ?? false, pricesIncludeTax: opts.pricesIncludeTax ?? true })
    .returning();
  const owner = await makeUser(org.id, "owner");
  const frontDesk = await makeUser(org.id, "front_desk");
  const provider = await makeUser(org.id, "provider");

  const [location] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
  const [patient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0001", firstName: "Ledger", lastName: "Patient", phone: "9000000000" })
    .returning();
  const [otherPatient] = await adminDb
    .insert(patients)
    .values({ organizationId: org.id, patientNumber: "P-0002", firstName: "Other", lastName: "Patient", phone: "9000000001" })
    .returning();

  const codes = await adminDb
    .insert(procedureCodes)
    .values([
      { organizationId: org.id, code: "FILL", shortName: "Filling", category: "restorative", appliesTo: "tooth", taxClass: "exempt_healthcare" },
      { organizationId: org.id, code: "CROWN", shortName: "Crown", category: "prosthodontic", appliesTo: "tooth", taxClass: "gst_5" },
      { organizationId: org.id, code: "WHITEN", shortName: "Whitening", category: "cosmetic", appliesTo: "mouth", taxClass: "gst_18" },
    ])
    .returning();
  const code = Object.fromEntries(codes.map((c) => [c.code, c]));

  const schedule = await createFeeSchedule(owner, { name: "Standard", effective_from: "2026-01-01", is_default: true });
  await upsertFeeScheduleItems(owner, schedule.id, [
    { procedure_code_id: code.FILL.id, price: "1500.00" },
    { procedure_code_id: code.CROWN.id, price: "12000.00" },
  ]);

  return { org, owner, frontDesk, provider, location, patient, otherPatient, code };
}

/** A procedure done chairside: charted and completed straight from the chart. */
async function completed(actor: RequestActor, patientId: string, codeId: string, opts: { tooth?: string; snapshot?: string } = {}) {
  const created = await createProcedure(actor, patientId, { procedure_code_id: codeId, ...(opts.tooth ? { tooth: opts.tooth } : {}) });
  const done = await updateProcedureStatus(actor, created.id, "completed");
  if (opts.snapshot) {
    // As if it went through an accepted plan, which snapshots the price.
    await adminDb.update(chartedProcedures).set({ price: opts.snapshot }).where(eq(chartedProcedures.id, done.id));
  }
  return done;
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function procedureStatus(id: string) {
  const [row] = await adminDb.select().from(chartedProcedures).where(eq(chartedProcedures.id, id));
  return row;
}

const year = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date());

describe("createInvoice", () => {
  afterEach(cleanup);

  it("invoices completed procedures at their snapshot or entered price and moves them to invoiced", async () => {
    const { owner, location, patient, code } = await setup();
    const fromPlan = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "11000.00" });
    const walkIn = await completed(owner, patient.id, code.FILL.id, { tooth: "36" });

    const { invoice, lines } = await createInvoice(owner, {
      patient_id: patient.id,
      location_id: location.id,
      charted_procedure_ids: [fromPlan.id, walkIn.id],
      prices: { [walkIn.id]: "1400.00" },
    });

    expect(invoice.invoiceNumber).toBe(`INV-${year()}-0001`);
    expect(invoice.status).toBe("issued");
    expect(invoice.total).toBe("12400.00");
    expect(invoice.taxTotal).toBe("0.00");
    expect(lines.map((l) => l.description).sort()).toEqual(["Crown · 46", "Filling · 36"]);
    expect((await procedureStatus(fromPlan.id)).status).toBe("invoiced");
    // The price entered at invoicing is written back so procedure and line agree.
    expect((await procedureStatus(walkIn.id)).price).toBe("1400.00");
  });

  it("refuses a procedure without a price, naming it, and writes nothing", async () => {
    const { owner, location, patient, code } = await setup();
    const unpriced = await completed(owner, patient.id, code.FILL.id, { tooth: "26" });

    await expect(
      createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [unpriced.id] }),
    ).rejects.toThrow(/Filling · 26 has no price/);
    expect((await procedureStatus(unpriced.id)).status).toBe("completed");
    expect(await adminDb.select().from(invoices).where(eq(invoices.patientId, patient.id))).toEqual([]);
  });

  it("refuses procedures that aren't completed, or belong to another patient", async () => {
    const { owner, location, patient, otherPatient, code } = await setup();
    const planned = await createProcedure(owner, patient.id, { procedure_code_id: code.FILL.id, tooth: "16" });
    const someoneElses = await completed(owner, otherPatient.id, code.FILL.id, { tooth: "16", snapshot: "1500.00" });

    for (const id of [planned.id, someoneElses.id]) {
      await expect(
        createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [id], prices: { [id]: "1.00" } }),
      ).rejects.toThrow(ProcedureNotInvoiceableError);
    }
  });

  it("numbers invoices sequentially under concurrent requests, with no duplicates or gaps", async () => {
    const { owner, location, patient, code } = await setup();
    const procs = await Promise.all(["11", "12", "13", "14", "15", "16"].map((t) => completed(owner, patient.id, code.FILL.id, { tooth: t, snapshot: "100.00" })));

    const results = await Promise.all(
      procs.map((p) => createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [p.id] })),
    );

    const numbers = results.map((r) => r.invoice.invoiceNumber).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6].map((n) => `INV-${year()}-000${n}`));
    // Six creates for one patient queue on the per-patient ledger lock (bug-log entry 15) — by
    // design — so under a loaded full-suite run this can exceed the default 5 s. ~0.5 s alone.
  }, 20_000);

  it("never bills the same procedure twice when two invoices race for it", async () => {
    const { owner, location, patient, code } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "21", snapshot: "1500.00" });

    const outcomes = await Promise.allSettled([
      createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] }),
      createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] }),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ProcedureNotInvoiceableError);
  });

  it("refuses roles without invoice write access", async () => {
    const { provider, location, patient, code, owner } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "21", snapshot: "1500.00" });
    await expect(
      createInvoice(provider, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("tax", () => {
  afterEach(cleanup);

  it("adds no tax when the organisation isn't GST-registered", async () => {
    const { owner, location, patient, code } = await setup({ gstRegistered: false });
    const crown = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "12000.00" });
    const { invoice, lines } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [crown.id] });
    expect(invoice).toMatchObject({ subtotal: "12000.00", taxTotal: "0.00", total: "12000.00" });
    expect(lines[0]).toMatchObject({ taxClass: "gst_5", taxRate: "0.00", taxAmount: "0.00" });
  });

  it("carves tax out of tax-inclusive prices, snapshotting class and rate per line", async () => {
    const { owner, location, patient, code } = await setup({ gstRegistered: true, pricesIncludeTax: true });
    const crown = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "12000.00" });
    const whitening = await completed(owner, patient.id, code.WHITEN.id, { snapshot: "10000.00" });
    const filling = await completed(owner, patient.id, code.FILL.id, { tooth: "36", snapshot: "1500.00" });

    const { invoice, lines } = await createInvoice(owner, {
      patient_id: patient.id,
      location_id: location.id,
      charted_procedure_ids: [crown.id, whitening.id, filling.id],
    });
    const byClass = Object.fromEntries(lines.map((l) => [l.taxClass, l]));

    // 12000 × 5/105 = 571.428… → 571.43; 10000 × 18/118 = 1525.42
    expect(byClass.gst_5).toMatchObject({ taxRate: "5.00", taxAmount: "571.43", unitPrice: "11428.57", lineTotal: "12000.00" });
    expect(byClass.gst_18).toMatchObject({ taxRate: "18.00", taxAmount: "1525.42", unitPrice: "8474.58", lineTotal: "10000.00" });
    expect(byClass.exempt_healthcare).toMatchObject({ taxRate: "0.00", taxAmount: "0.00", lineTotal: "1500.00" });
    // The patient pays exactly what was quoted.
    expect(invoice).toMatchObject({ total: "23500.00", taxTotal: "2096.85", subtotal: "21403.15" });
  });

  it("adds tax on top when the clinic quotes before tax", async () => {
    const { owner, location, patient, code } = await setup({ gstRegistered: true, pricesIncludeTax: false });
    const crown = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "12000.00" });
    const { invoice } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [crown.id] });
    expect(invoice).toMatchObject({ subtotal: "12000.00", taxTotal: "600.00", total: "12600.00" });
  });
});

describe("voidInvoice", () => {
  afterEach(cleanup);

  it("voids with a reason and returns the procedures to completed so they can be reissued", async () => {
    const { owner, location, patient, code } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    const { invoice } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });

    const voided = await voidInvoice(owner, invoice.id, "Wrong tooth");

    expect(voided).toMatchObject({ status: "void", voidReason: "Wrong tooth" });
    expect(voided.voidedAt).not.toBeNull();
    expect((await procedureStatus(proc.id)).status).toBe("completed");
    const reissued = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });
    expect(reissued.invoice.invoiceNumber).toBe(`INV-${year()}-0002`);
    await expect(voidInvoice(owner, invoice.id, "again")).rejects.toThrow(InvoiceAlreadyVoidError);
  });

  it("lets front desk void only on the day the invoice was issued; managers any day", async () => {
    const { owner, frontDesk, location, patient, code } = await setup();
    const today = await completed(owner, patient.id, code.FILL.id, { tooth: "11", snapshot: "100.00" });
    const older = await completed(owner, patient.id, code.FILL.id, { tooth: "12", snapshot: "100.00" });
    const { invoice: todays } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [today.id] });
    const { invoice: yesterdays } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [older.id] });
    await adminDb.update(invoices).set({ issuedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).where(eq(invoices.id, yesterdays.id));

    await expect(voidInvoice(frontDesk, todays.id, "Typo")).resolves.toMatchObject({ status: "void" });
    await expect(voidInvoice(frontDesk, yesterdays.id, "Typo")).rejects.toThrow(ChargeReductionNotAllowedError);
    await expect(voidInvoice(owner, yesterdays.id, "Typo")).resolves.toMatchObject({ status: "void" });
  });
});

describe("payments and balance", () => {
  afterEach(cleanup);

  async function invoiced(total: string) {
    const ctx = await setup();
    const proc = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "36", snapshot: total });
    const { invoice } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [proc.id] });
    return { ...ctx, invoice, proc };
  }

  it("takes a part payment and computes the balance from the rows", async () => {
    const { owner, location, patient, invoice } = await invoiced("1500.00");

    await recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "1000.00", method: "upi", allocations: [{ invoice_id: invoice.id, amount: "1000.00" }] });

    const ledger = await getPatientLedger(owner, patient.id);
    expect(ledger.balance).toBe("500.00");
    expect(ledger.credit).toBe("0.00");
    expect(ledger.invoices[0].outstanding).toBe("500.00");
    expect(ledger.entries.map((e) => [e.kind, e.amount, e.balance])).toEqual([
      ["invoice", "1500.00", "1500.00"],
      ["payment", "-1000.00", "500.00"],
    ]);
  });

  it("refuses allocating more than an invoice's outstanding or more than the payment", async () => {
    const { owner, location, patient, invoice } = await invoiced("1500.00");
    await expect(
      recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "2000.00", method: "cash", allocations: [{ invoice_id: invoice.id, amount: "1600.00" }] }),
    ).rejects.toThrow(PaymentExceedsBalanceError);
    await expect(
      recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "100.00", method: "cash", allocations: [{ invoice_id: invoice.id, amount: "200.00" }] }),
    ).rejects.toThrow(PaymentExceedsBalanceError);
    expect(await adminDb.select().from(payments).where(eq(payments.patientId, patient.id))).toEqual([]);
  });

  it("keeps an unallocated remainder as patient credit", async () => {
    const { owner, location, patient, invoice } = await invoiced("1500.00");
    await recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "2000.00", method: "cash", allocations: [{ invoice_id: invoice.id, amount: "1500.00" }] });
    const ledger = await getPatientLedger(owner, patient.id);
    expect(ledger.balance).toBe("-500.00");
    expect(ledger.credit).toBe("500.00");
  });

  it("honours Idempotency-Key: a repeat returns the same payment, a different body is refused", async () => {
    const { owner, location, patient, invoice } = await invoiced("1500.00");
    const body = { patient_id: patient.id, location_id: location.id, amount: "500.00", method: "card" as const, allocations: [{ invoice_id: invoice.id, amount: "500.00" }] };

    const first = await recordPayment(owner, body, "key-123");
    const again = await recordPayment(owner, body, "key-123");
    expect(again.payment.id).toBe(first.payment.id);
    expect(again.replayed).toBe(true);
    expect(await adminDb.select().from(payments).where(eq(payments.patientId, patient.id))).toHaveLength(1);

    await expect(recordPayment(owner, { ...body, amount: "600.00", allocations: [] }, "key-123")).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it("records the money once when the same key arrives twice at the same moment", async () => {
    const { owner, location, patient } = await invoiced("1500.00");
    const body = { patient_id: patient.id, location_id: location.id, amount: "500.00", method: "cash" as const };
    const [a, b] = await Promise.all([recordPayment(owner, body, "race-key"), recordPayment(owner, body, "race-key")]);
    expect(a.payment.id).toBe(b.payment.id);
    expect(await adminDb.select().from(payments).where(eq(payments.patientId, patient.id))).toHaveLength(1);
  });

  it("turns money paid on a voided invoice into credit, which can be applied to the reissue", async () => {
    const { owner, location, patient, invoice, proc } = await invoiced("1500.00");
    await recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "1000.00", method: "upi", allocations: [{ invoice_id: invoice.id, amount: "1000.00" }] });

    await voidInvoice(owner, invoice.id, "Wrong price");
    let ledger = await getPatientLedger(owner, patient.id);
    expect(ledger.credit).toBe("1000.00");
    expect(ledger.balance).toBe("-1000.00");

    const { invoice: reissue } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });
    await applyCredit(owner, { patient_id: patient.id, invoice_id: reissue.id, amount: "1000.00" });

    ledger = await getPatientLedger(owner, patient.id);
    expect(ledger.credit).toBe("0.00");
    expect(ledger.balance).toBe("500.00");
    expect(ledger.invoices.find((i) => i.invoice.id === reissue.id)?.outstanding).toBe("500.00");
    await expect(applyCredit(owner, { patient_id: patient.id, invoice_id: reissue.id, amount: "1.00" })).rejects.toThrow(PaymentExceedsBalanceError);
  });
});

describe("createAdjustment", () => {
  afterEach(cleanup);

  it("applies a discount, refuses one larger than what's owed, and follows the same-day rule", async () => {
    const { owner, frontDesk, location, patient, code } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    const { invoice } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });

    await createAdjustment(frontDesk, { invoice_id: invoice.id, amount: "-200.00", adjustment_type: "discount", reason: "Senior citizen" });
    expect((await getInvoice(owner, invoice.id)).outstanding).toBe("1300.00");

    await expect(
      createAdjustment(owner, { invoice_id: invoice.id, amount: "-1400.00", adjustment_type: "writeoff", reason: "Too much" }),
    ).rejects.toThrow(AdjustmentInvalidError);

    await adminDb.update(invoices).set({ issuedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).where(eq(invoices.id, invoice.id));
    await expect(
      createAdjustment(frontDesk, { invoice_id: invoice.id, amount: "-100.00", adjustment_type: "discount", reason: "Late" }),
    ).rejects.toThrow(ChargeReductionNotAllowedError);
  });
});

describe("tenancy and patient boundaries", () => {
  afterEach(cleanup);

  it("refuses another org's invoice and another patient's invoice", async () => {
    const a = await setup();
    const b = await setup();
    const proc = await completed(a.owner, a.patient.id, a.code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    const { invoice } = await createInvoice(a.owner, { patient_id: a.patient.id, location_id: a.location.id, charted_procedure_ids: [proc.id] });

    await expect(getInvoice(b.owner, invoice.id)).rejects.toThrow(InvoiceNotFoundError);
    await expect(voidInvoice(b.owner, invoice.id, "not mine")).rejects.toThrow(InvoiceNotFoundError);
    // Paying for patient A's invoice while recording the payment against patient B.
    await expect(
      recordPayment(a.owner, { patient_id: a.otherPatient.id, location_id: a.location.id, amount: "100.00", method: "cash", allocations: [{ invoice_id: invoice.id, amount: "100.00" }] }),
    ).rejects.toThrow(InvoiceNotFoundError);
    // Another org's location can't be used either.
    const proc2 = await completed(a.owner, a.patient.id, a.code.FILL.id, { tooth: "37", snapshot: "1500.00" });
    await expect(
      createInvoice(a.owner, { patient_id: a.patient.id, location_id: b.location.id, charted_procedure_ids: [proc2.id] }),
    ).rejects.toThrow(/Location not found/);
  });
});

describe("reads", () => {
  afterEach(cleanup);

  it("lists invoiceable procedures with their price source, and suggests a location", async () => {
    const { owner, location, patient, code } = await setup();
    const snap = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "11000.00" });
    const live = await completed(owner, patient.id, code.FILL.id, { tooth: "36" });
    const none = await completed(owner, patient.id, code.WHITEN.id);

    const list = await listInvoiceableProcedures(owner, patient.id);
    const byId = Object.fromEntries(list.map((r) => [r.procedure.id, r]));
    expect(byId[snap.id]).toMatchObject({ price: "11000.00", priceSource: "snapshot" });
    expect(byId[live.id]).toMatchObject({ price: "1500.00", priceSource: "fee_schedule" });
    expect(byId[none.id]).toMatchObject({ price: null, priceSource: null });

    expect(await suggestInvoiceLocation(owner, patient.id, [snap.id])).toEqual({ locationId: location.id, mixed: false });
  });

  it("org ledger lists recent invoices and patients who owe money", async () => {
    const { owner, location, patient, code } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });

    const org = await getOrganizationLedger(owner);
    expect(org.recentInvoices).toHaveLength(1);
    expect(org.balances).toEqual([expect.objectContaining({ patientId: patient.id, balance: "1500.00" })]);
  });
});

// Bugs found in the 12 Nov review (docs/bug-log.md entries 14–17).
describe("review fixes", () => {
  afterEach(cleanup);

  async function invoicedFor(total: string) {
    const ctx = await setup();
    const proc = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "36", snapshot: total });
    const { invoice } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [proc.id] });
    return { ...ctx, invoice };
  }

  it("never over-allocates an invoice when two payments arrive at once", async () => {
    const { owner, location, patient, invoice } = await invoicedFor("1000.00");
    const pay = (key: string) =>
      recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "1000.00", method: "cash", allocations: [{ invoice_id: invoice.id, amount: "1000.00" }] }, key);

    const outcomes = await Promise.allSettled([pay("k1"), pay("k2")]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect((await getInvoice(owner, invoice.id)).outstanding).toBe("0.00");
  });

  it("never spends the same credit twice when two apply-credit calls race", async () => {
    const ctx = await setup();
    const a = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "36", snapshot: "1000.00" });
    const b = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "37", snapshot: "1000.00" });
    const { invoice: invA } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [a.id] });
    const { invoice: invB } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [b.id] });
    await recordPayment(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, amount: "1000.00", method: "cash" });

    const outcomes = await Promise.allSettled([
      applyCredit(ctx.owner, { patient_id: ctx.patient.id, invoice_id: invA.id, amount: "1000.00" }),
      applyCredit(ctx.owner, { patient_id: ctx.patient.id, invoice_id: invB.id, amount: "1000.00" }),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect((await getPatientLedger(ctx.owner, ctx.patient.id)).credit).toBe("0.00");
  });

  it("requires discounts and write-offs to reduce the bill", async () => {
    const { owner, invoice } = await invoicedFor("1500.00");
    for (const type of ["discount", "writeoff"] as const) {
      await expect(createAdjustment(owner, { invoice_id: invoice.id, amount: "200.00", adjustment_type: type, reason: "x" })).rejects.toThrow(AdjustmentInvalidError);
    }
    // A correction may go either way.
    await expect(createAdjustment(owner, { invoice_id: invoice.id, amount: "100.00", adjustment_type: "correction", reason: "Missed X-ray" })).resolves.toBeTruthy();
  });

  it("refuses amounts larger than the column can hold instead of failing in the database", async () => {
    const { owner, location, patient } = await invoicedFor("1500.00");
    await expect(
      recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "100000000.00", method: "cash" }),
    ).rejects.toThrow(/not a valid amount/);
  });

  it("reports what was actually paid on each invoice, net of discounts", async () => {
    const { owner, location, patient, invoice } = await invoicedFor("1000.00");
    await createAdjustment(owner, { invoice_id: invoice.id, amount: "-200.00", adjustment_type: "discount", reason: "Senior" });
    await recordPayment(owner, { patient_id: patient.id, location_id: location.id, amount: "800.00", method: "upi", allocations: [{ invoice_id: invoice.id, amount: "800.00" }] });

    const ledger = await getPatientLedger(owner, patient.id);
    const row = ledger.invoices.find((i) => i.invoice.id === invoice.id);
    expect(row?.outstanding).toBe("0.00");
    expect(row?.paid).toBe("800.00");
  });

  it("treats the same allocations in a different order as the same idempotent request", async () => {
    const ctx = await setup();
    const a = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "36", snapshot: "500.00" });
    const b = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "37", snapshot: "500.00" });
    const { invoice: invA } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [a.id] });
    const { invoice: invB } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [b.id] });
    const base = { patient_id: ctx.patient.id, location_id: ctx.location.id, amount: "1000.00", method: "cash" as const };
    const first = await recordPayment(ctx.owner, { ...base, allocations: [{ invoice_id: invA.id, amount: "500.00" }, { invoice_id: invB.id, amount: "500.00" }] }, "order-key");
    const again = await recordPayment(ctx.owner, { ...base, allocations: [{ invoice_id: invB.id, amount: "500.00" }, { invoice_id: invA.id, amount: "500.00" }] }, "order-key");
    expect(again.payment.id).toBe(first.payment.id);
  });
});

// docs/bug-log.md entry 28: the printout decided "tax invoice vs receipt" from the clinic's
// current GST setting, so old receipts reprinted as tax invoices after registering.
describe("tax status is recorded on the invoice at issue", () => {
  afterEach(cleanup);

  it("keeps an invoice issued while unregistered a receipt after the clinic registers", async () => {
    const { org, owner, location, patient, code } = await setup({ gstRegistered: false });
    const proc = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "12000.00" });
    const { invoice } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });

    await adminDb.update(organizations).set({ gstRegistered: true, gstin: "27AAAAA0000A1Z5" }).where(eq(organizations.id, org.id));

    const detail = await getInvoice(owner, invoice.id);
    expect(detail.invoice.gstRegistered).toBe(false);
    expect(detail.invoice.gstin).toBeNull();
  });

  it("records the GSTIN on an invoice issued while registered", async () => {
    const { org, owner, location, patient, code } = await setup({ gstRegistered: true });
    await adminDb.update(organizations).set({ gstin: "27AAAAA0000A1Z5" }).where(eq(organizations.id, org.id));
    const proc = await completed(owner, patient.id, code.CROWN.id, { tooth: "46", snapshot: "12000.00" });
    const { invoice } = await createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id] });
    expect(invoice).toMatchObject({ gstRegistered: true, gstin: "27AAAAA0000A1Z5" });
  });
});

// Reversing a payment recorded by mistake (docs/specs/ledger.md, "Reversing a payment").
describe("reversePayment", () => {
  afterEach(cleanup);

  async function paidInvoice() {
    const ctx = await setup();
    const proc = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    const { invoice } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [proc.id] });
    const { payment } = await recordPayment(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, amount: "500.00", method: "upi", allocations: [{ invoice_id: invoice.id, amount: "500.00" }] });
    return { ...ctx, invoice, payment };
  }

  it("takes the money back off the invoice and the balance, keeping the payment on record", async () => {
    const { owner, patient, invoice, payment } = await paidInvoice();
    expect((await getPatientLedger(owner, patient.id)).balance).toBe("1000.00");

    await reversePayment(owner, payment.id, "Recorded against the wrong patient");

    const ledger = await getPatientLedger(owner, patient.id);
    expect(ledger.balance).toBe("1500.00");
    expect(ledger.invoices.find((i) => i.invoice.id === invoice.id)).toMatchObject({ outstanding: "1500.00", paid: "0.00" });
    expect(ledger.entries.map((e) => [e.kind, e.amount, e.balance])).toEqual([
      ["invoice", "1500.00", "1500.00"],
      ["payment", "-500.00", "1000.00"],
      ["reversal", "500.00", "1500.00"],
    ]);
    // The payment row itself is untouched (append-only).
    expect(await adminDb.select().from(payments).where(eq(payments.id, payment.id))).toHaveLength(1);
  });

  it("also undoes credit from that payment that was applied to another invoice", async () => {
    const ctx = await setup();
    const proc = await completed(ctx.owner, ctx.patient.id, ctx.code.FILL.id, { tooth: "36", snapshot: "1000.00" });
    const { invoice } = await createInvoice(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, charted_procedure_ids: [proc.id] });
    const { payment } = await recordPayment(ctx.owner, { patient_id: ctx.patient.id, location_id: ctx.location.id, amount: "1000.00", method: "cash" });
    await applyCredit(ctx.owner, { patient_id: ctx.patient.id, invoice_id: invoice.id, amount: "1000.00" });
    expect((await getInvoice(ctx.owner, invoice.id)).outstanding).toBe("0.00");

    await reversePayment(ctx.owner, payment.id, "Cheque bounced");

    expect((await getInvoice(ctx.owner, invoice.id)).outstanding).toBe("1000.00");
    expect((await getPatientLedger(ctx.owner, ctx.patient.id)).credit).toBe("0.00");
  });

  it("can't reverse the same payment twice", async () => {
    const { owner, payment } = await paidInvoice();
    await reversePayment(owner, payment.id, "Mistake");
    await expect(reversePayment(owner, payment.id, "Again")).rejects.toThrow(PaymentAlreadyReversedError);
  });

  it("lets front desk reverse only on the day the money was received; managers any day", async () => {
    const { owner, frontDesk, provider, payment } = await paidInvoice();
    await expect(reversePayment(provider, payment.id, "x")).rejects.toThrow(PermissionDeniedError);
    // Age the payment through the admin connection (the app role can't update payments).
    await adminDb.update(payments).set({ receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).where(eq(payments.id, payment.id));
    await expect(reversePayment(frontDesk, payment.id, "Late")).rejects.toThrow(ChargeReductionNotAllowedError);
    await expect(reversePayment(owner, payment.id, "Late")).resolves.toBeTruthy();
  });

  it("refuses another organisation's payment", async () => {
    const a = await paidInvoice();
    const b = await setup();
    await expect(reversePayment(b.owner, a.payment.id, "Not mine")).rejects.toThrow(PaymentNotFoundError);
  });

  it("keeps the org ledger in step", async () => {
    const { owner, patient, payment } = await paidInvoice();
    await reversePayment(owner, payment.id, "Mistake");
    const org = await getOrganizationLedger(owner);
    expect(org.balances.find((b) => b.patientId === patient.id)?.balance).toBe("1500.00");
  });
});

// A discount given at billing time, in the same step as creating the invoice.
describe("createInvoice with a discount", () => {
  afterEach(cleanup);

  it("records the discount as an adjustment on the new invoice", async () => {
    const { owner, location, patient, code } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    const { invoice } = await createInvoice(owner, {
      patient_id: patient.id,
      location_id: location.id,
      charted_procedure_ids: [proc.id],
      discount: { amount: "150.00", reason: "Senior citizen 10%" },
    });
    const detail = await getInvoice(owner, invoice.id);
    expect(invoice.total).toBe("1500.00"); // the invoice keeps its full price…
    expect(detail.outstanding).toBe("1350.00"); // …the discount reduces what's owed
    expect(detail.adjustments).toEqual([expect.objectContaining({ amount: "-150.00", adjustmentType: "discount", reason: "Senior citizen 10%" })]);
  });

  it("refuses a discount bigger than the invoice, writing nothing", async () => {
    const { owner, location, patient, code } = await setup();
    const proc = await completed(owner, patient.id, code.FILL.id, { tooth: "36", snapshot: "1500.00" });
    await expect(
      createInvoice(owner, { patient_id: patient.id, location_id: location.id, charted_procedure_ids: [proc.id], discount: { amount: "1600.00", reason: "x" } }),
    ).rejects.toThrow(AdjustmentInvalidError);
    expect(await adminDb.select().from(invoices).where(eq(invoices.patientId, patient.id))).toEqual([]);
  });
});
