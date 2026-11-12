import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { adminDb } from "./client";
import { dbForRequest } from "./tenant";
import { organizations, users, locations, userLocationAccess } from "./schema";
import { wipeOrganizationData } from "./wipe-organization";

/**
 * The tenancy gate: every table with an organization_id column must have row-level
 * security enabled and a policy attached. This is a CI-blocking test, not a lint —
 * see docs/specs/data-model.md ("the CI gate fails the build otherwise").
 *
 * Run against a migrated database (docker compose up && npm run db:migrate first).
 */
describe("Row-level security enforcement", () => {
  it("every table with organization_id has RLS enabled", async () => {
    const rows = await adminDb.execute<{ table_name: string; relrowsecurity: boolean }>(sql`
      select c.table_name, pc.relrowsecurity
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      where c.table_schema = 'public'
        and c.column_name = 'organization_id'
    `);

    const withoutRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.table_name);
    expect(withoutRls, `Tables missing RLS: ${withoutRls.join(", ")}`).toEqual([]);
  });

  it("every RLS-enabled table has a tenant_isolation policy", async () => {
    const rows = await adminDb.execute<{ table_name: string }>(sql`
      select distinct c.table_name
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      where c.table_schema = 'public'
        and (c.column_name = 'organization_id' or c.table_name = 'organizations')
        and pc.relrowsecurity = true
        and not exists (
          select 1 from pg_policies p
          where p.tablename = c.table_name and p.policyname = 'tenant_isolation'
        )
    `);

    expect(rows, `Tables missing tenant_isolation policy: ${rows.map((r) => r.table_name).join(", ")}`).toEqual([]);
  });

  it("organizations itself is RLS-protected", async () => {
    const rows = await adminDb.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class where relname = 'organizations'
    `);
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("the ledger is append-only for the app role", async () => {
    const rows = await adminDb.execute<{ table_name: string; privilege_type: string }>(sql`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'dentit_app'
        and (
          (table_name in ('invoice_lines', 'payments', 'payment_allocations', 'adjustments', 'payment_reversals')
            and privilege_type in ('UPDATE', 'DELETE'))
          or (table_name = 'invoices' and privilege_type = 'DELETE')
        )
    `);
    expect(rows).toEqual([]);
  });

  it("audit_log has no UPDATE or DELETE grant for the app role", async () => {
    const rows = await adminDb.execute<{ privilege_type: string }>(sql`
      select privilege_type from information_schema.role_table_grants
      where table_name = 'audit_log' and grantee = 'dentit_app'
        and privilege_type in ('UPDATE', 'DELETE')
    `);
    expect(rows).toEqual([]);
  });
});

// user_location_access has no organization_id column (it's keyed by user and location), so
// the organization_id scan above can't see it. It is tenant data all the same.
// docs/bug-log.md entry 21.
describe("user_location_access tenancy", () => {
  it("has RLS and a tenant_isolation policy", async () => {
    const [{ relrowsecurity }] = await adminDb.execute<{ relrowsecurity: boolean }>(sql`
      select relrowsecurity from pg_class where relname = 'user_location_access'
    `);
    const policies = await adminDb.execute(sql`
      select 1 from pg_policies where tablename = 'user_location_access' and policyname = 'tenant_isolation'
    `);
    expect(relrowsecurity).toBe(true);
    expect(policies).toHaveLength(1);
  });

  it("hides another organisation's rows, and is cleared by wipeOrganizationData", async () => {
    const make = async (name: string) => {
      const [org] = await adminDb.insert(organizations).values({ name }).returning();
      const [user] = await adminDb.insert(users).values({ organizationId: org.id, email: `${name}@example.test`, fullName: name, role: "front_desk" }).returning();
      const [loc] = await adminDb.insert(locations).values({ organizationId: org.id, name: "Main" }).returning();
      await adminDb.insert(userLocationAccess).values({ userId: user.id, locationId: loc.id });
      return org;
    };
    const a = await make("__rls_ula_a");
    const b = await make("__rls_ula_b");
    try {
      const seenFromB = await dbForRequest(b.id, (tx) => tx.select().from(userLocationAccess));
      expect(seenFromB).toHaveLength(1);
      expect(seenFromB.every((r) => r.userId !== undefined)).toBe(true);
      const aUsers = await adminDb.select({ id: users.id }).from(users).where(eq(users.organizationId, a.id));
      expect(seenFromB.map((r) => r.userId)).not.toContain(aUsers[0].id);
    } finally {
      for (const org of [a, b]) {
        await wipeOrganizationData(adminDb, org.id);
        await adminDb.delete(organizations).where(eq(organizations.id, org.id));
      }
    }
  });
});
