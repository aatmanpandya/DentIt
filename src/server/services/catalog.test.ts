import { describe, it, expect, afterEach } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users, procedureCodes } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import type { RequestActor } from "@/server/lib/request-auth";
import { PermissionDeniedError } from "@/server/lib/permissions";
import {
  listProcedureCodes,
  createProcedureCode,
  updateProcedureCode,
  importStarterTemplate,
  createFeeSchedule,
  listFeeSchedules,
  listFeeScheduleItems,
  upsertFeeScheduleItems,
  getPricing,
  ProcedureCodeNotFoundError,
  DuplicateProcedureCodeError,
  FeeScheduleNotFoundError,
  FeeScheduleNoPriceError,
} from "./catalog";

const TEST_ORG_NAME = "__catalog_service_test";
const STARTER_CODE_PREFIX = "TESTSTARTER-";

async function createTestOrgAndActor(role: RequestActor["role"] = "owner") {
  const [org] = await adminDb.insert(organizations).values({ name: TEST_ORG_NAME }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId: org.id, email: `catalog-test-${role}@example.test`, fullName: "Test User", role })
    .returning();
  const actor: RequestActor = { userId: user.id, organizationId: org.id, role };
  return { org, user, actor };
}

async function insertStarterRow(code: string, overrides: Partial<typeof procedureCodes.$inferInsert> = {}) {
  const [row] = await adminDb
    .insert(procedureCodes)
    .values({
      organizationId: null,
      code,
      shortName: `Starter ${code}`,
      category: "diagnostic",
      appliesTo: "mouth",
      ...overrides,
    })
    .returning();
  return row;
}

async function cleanup() {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, TEST_ORG_NAME));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
  // Starter-template rows have no organizationId, so wipeOrganizationData can't reach them —
  // swept separately by the test-only code prefix instead.
  const starterRows = await adminDb
    .select({ id: procedureCodes.id, code: procedureCodes.code })
    .from(procedureCodes)
    .where(isNull(procedureCodes.organizationId));
  for (const row of starterRows) {
    if (row.code.startsWith(STARTER_CODE_PREFIX)) {
      await adminDb.delete(procedureCodes).where(eq(procedureCodes.id, row.id));
    }
  }
}

describe("listProcedureCodes / createProcedureCode", () => {
  afterEach(cleanup);

  it("creates a procedure code scoped to the actor's org", async () => {
    const { actor } = await createTestOrgAndActor();

    const code = await createProcedureCode(actor, {
      code: "TEST-RCT",
      short_name: "Root canal treatment",
      category: "endodontic",
      applies_to: "tooth",
    });

    expect(code.code).toBe("TEST-RCT");
    expect(code.organizationId).toBe(actor.organizationId);
    expect(code.isActive).toBe(true);
    expect(code.taxClass).toBe("exempt_healthcare");
  });

  it("rejects a provider — catalog write is owner/admin/accountant only", async () => {
    const { actor } = await createTestOrgAndActor("provider");

    await expect(
      createProcedureCode(actor, { code: "TEST-X", short_name: "X", category: "diagnostic", applies_to: "mouth" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects a duplicate code within the same org", async () => {
    const { actor } = await createTestOrgAndActor();
    await createProcedureCode(actor, { code: "TEST-DUP", short_name: "A", category: "diagnostic", applies_to: "mouth" });

    await expect(
      createProcedureCode(actor, { code: "TEST-DUP", short_name: "B", category: "diagnostic", applies_to: "mouth" }),
    ).rejects.toThrow(DuplicateProcedureCodeError);
  });

  it("listProcedureCodes never returns the shared starter template as the org's own catalog", async () => {
    const { actor } = await createTestOrgAndActor();
    await insertStarterRow(`${STARTER_CODE_PREFIX}1`);
    await createProcedureCode(actor, { code: "TEST-OWN", short_name: "Own", category: "diagnostic", applies_to: "mouth" });

    const { data } = await listProcedureCodes(actor);

    expect(data.map((d) => d.code)).toEqual(["TEST-OWN"]);
  });

  it("filters by category and q", async () => {
    const { actor } = await createTestOrgAndActor();
    await createProcedureCode(actor, { code: "TEST-A", short_name: "Scaling", category: "preventive", applies_to: "mouth" });
    await createProcedureCode(actor, { code: "TEST-B", short_name: "Extraction", category: "oral_surgery", applies_to: "tooth" });

    const byCategory = await listProcedureCodes(actor, { category: "preventive" });
    expect(byCategory.data.map((d) => d.code)).toEqual(["TEST-A"]);

    const byQ = await listProcedureCodes(actor, { q: "extract" });
    expect(byQ.data.map((d) => d.code)).toEqual(["TEST-B"]);
  });
});

describe("updateProcedureCode", () => {
  afterEach(cleanup);

  it("updates fields and returns the row", async () => {
    const { actor } = await createTestOrgAndActor();
    const created = await createProcedureCode(actor, {
      code: "TEST-UPD",
      short_name: "Before",
      category: "diagnostic",
      applies_to: "mouth",
    });

    const updated = await updateProcedureCode(actor, created.id, { short_name: "After", is_active: false });

    expect(updated.shortName).toBe("After");
    expect(updated.isActive).toBe(false);
  });

  it("throws ProcedureCodeNotFoundError for a code belonging to another org", async () => {
    const { actor: actorA } = await createTestOrgAndActor();
    const other = await createTestOrgAndActor();
    const otherCode = await createProcedureCode(other.actor, {
      code: "TEST-OTHERORG",
      short_name: "Other org's code",
      category: "diagnostic",
      applies_to: "mouth",
    });
    await wipeOrganizationData(adminDb, other.org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, other.org.id));

    await expect(updateProcedureCode(actorA, otherCode.id, { short_name: "Hijacked" })).rejects.toThrow(
      ProcedureCodeNotFoundError,
    );
  });

  it("throws ProcedureCodeNotFoundError for a starter-template id — it's not this org's row to edit", async () => {
    const { actor } = await createTestOrgAndActor();
    const starter = await insertStarterRow(`${STARTER_CODE_PREFIX}2`);

    await expect(updateProcedureCode(actor, starter.id, { short_name: "Hijacked" })).rejects.toThrow(
      ProcedureCodeNotFoundError,
    );
  });
});

describe("importStarterTemplate", () => {
  afterEach(cleanup);

  it("copies starter-template rows into the org's own catalog", async () => {
    const { actor } = await createTestOrgAndActor();
    await insertStarterRow(`${STARTER_CODE_PREFIX}3`, { shortName: "Scaling" });
    await insertStarterRow(`${STARTER_CODE_PREFIX}4`, { shortName: "Extraction" });

    const imported = await importStarterTemplate(actor);

    expect(imported.length).toBeGreaterThanOrEqual(2);
    const importedCodes = imported.map((d) => d.code);
    expect(importedCodes).toContain(`${STARTER_CODE_PREFIX}3`);
    expect(importedCodes).toContain(`${STARTER_CODE_PREFIX}4`);
    expect(imported.every((d) => d.organizationId === actor.organizationId)).toBe(true);

    // The real starter template now has 70+ rows (see migration 0006), so a plain
    // listProcedureCodes() would truncate at its default page size — search instead of
    // paging through everything, same as the real catalog screen would.
    const { data } = await listProcedureCodes(actor, { q: STARTER_CODE_PREFIX });
    expect(data.map((d) => d.code)).toEqual(expect.arrayContaining([`${STARTER_CODE_PREFIX}3`, `${STARTER_CODE_PREFIX}4`]));
  });

  it("is idempotent — re-importing skips codes already present in the org", async () => {
    const { actor } = await createTestOrgAndActor();
    await insertStarterRow(`${STARTER_CODE_PREFIX}5`);

    await importStarterTemplate(actor);
    const second = await importStarterTemplate(actor);

    // Not asserting `second` is empty outright — other test files run concurrently and
    // may add their own organization_id IS NULL rows mid-test, which legitimately show
    // up as newly importable. The actual invariant is that *this* row isn't reimported.
    expect(second.some((d) => d.code === `${STARTER_CODE_PREFIX}5`)).toBe(false);
    const { data } = await listProcedureCodes(actor, { q: STARTER_CODE_PREFIX });
    expect(data.filter((d) => d.code === `${STARTER_CODE_PREFIX}5`)).toHaveLength(1);
  });

  it("rejects a provider — importing is a catalog-write action", async () => {
    const { actor } = await createTestOrgAndActor("provider");
    await expect(importStarterTemplate(actor)).rejects.toThrow(PermissionDeniedError);
  });
});

describe("fee schedules", () => {
  afterEach(cleanup);

  it("creates a fee schedule and bulk-upserts items, leaving untouched items alone", async () => {
    const { actor } = await createTestOrgAndActor();
    const codeA = await createProcedureCode(actor, { code: "TEST-FEE-A", short_name: "A", category: "diagnostic", applies_to: "mouth" });
    const codeB = await createProcedureCode(actor, { code: "TEST-FEE-B", short_name: "B", category: "diagnostic", applies_to: "mouth" });

    const schedule = await createFeeSchedule(actor, { name: "Standard", effective_from: "2026-01-01" });

    await upsertFeeScheduleItems(actor, schedule.id, [
      { procedure_code_id: codeA.id, price: "300.00" },
      { procedure_code_id: codeB.id, price: "500.00" },
    ]);

    await upsertFeeScheduleItems(actor, schedule.id, [{ procedure_code_id: codeA.id, price: "350.00" }]);

    const items = await listFeeScheduleItems(actor, schedule.id);
    const byCode = Object.fromEntries(items.map((i) => [i.procedureCodeId, i.price]));
    expect(byCode[codeA.id]).toBe("350.00");
    expect(byCode[codeB.id]).toBe("500.00");
  });

  it("throws FeeScheduleNotFoundError for a schedule belonging to another org", async () => {
    const { actor: actorA } = await createTestOrgAndActor();
    const other = await createTestOrgAndActor();
    const otherSchedule = await createFeeSchedule(other.actor, { name: "Other", effective_from: "2026-01-01" });
    await wipeOrganizationData(adminDb, other.org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, other.org.id));

    await expect(listFeeScheduleItems(actorA, otherSchedule.id)).rejects.toThrow(FeeScheduleNotFoundError);
  });

  it("accountant can create fee schedules — matches the existing fee_schedules RBAC entry", async () => {
    const { actor } = await createTestOrgAndActor("accountant");
    const schedule = await createFeeSchedule(actor, { name: "Accountant's", effective_from: "2026-01-01" });
    expect(schedule.name).toBe("Accountant's");
  });

  it("lists fee schedules for the org", async () => {
    const { actor } = await createTestOrgAndActor();
    await createFeeSchedule(actor, { name: "One", effective_from: "2026-01-01" });
    await createFeeSchedule(actor, { name: "Two", effective_from: "2026-02-01" });

    const schedules = await listFeeSchedules(actor);
    expect(schedules.map((s) => s.name).sort()).toEqual(["One", "Two"]);
  });
});

describe("getPricing", () => {
  afterEach(cleanup);

  it("resolves the price from the org's default fee schedule", async () => {
    const { actor } = await createTestOrgAndActor();
    const code = await createProcedureCode(actor, { code: "TEST-PRICE", short_name: "Priced", category: "diagnostic", applies_to: "mouth" });
    const schedule = await createFeeSchedule(actor, { name: "Default", effective_from: "2026-01-01", is_default: true });
    await upsertFeeScheduleItems(actor, schedule.id, [{ procedure_code_id: code.id, price: "450.00" }]);

    const result = await getPricing(actor, { procedure_code_id: code.id, on_date: "2026-06-01" });

    expect(result.price).toBe("450.00");
    expect(result.fee_schedule_id).toBe(schedule.id);
  });

  it("throws FeeScheduleNoPriceError when nothing is priced yet", async () => {
    const { actor } = await createTestOrgAndActor();
    const code = await createProcedureCode(actor, { code: "TEST-UNPRICED", short_name: "Unpriced", category: "diagnostic", applies_to: "mouth" });

    await expect(getPricing(actor, { procedure_code_id: code.id })).rejects.toThrow(FeeScheduleNoPriceError);
  });

  it("ignores a schedule that isn't effective yet on the given date", async () => {
    const { actor } = await createTestOrgAndActor();
    const code = await createProcedureCode(actor, { code: "TEST-FUTURE", short_name: "Future", category: "diagnostic", applies_to: "mouth" });
    const schedule = await createFeeSchedule(actor, { name: "Next year", effective_from: "2027-01-01", is_default: true });
    await upsertFeeScheduleItems(actor, schedule.id, [{ procedure_code_id: code.id, price: "999.00" }]);

    await expect(getPricing(actor, { procedure_code_id: code.id, on_date: "2026-06-01" })).rejects.toThrow(
      FeeScheduleNoPriceError,
    );
  });
});
