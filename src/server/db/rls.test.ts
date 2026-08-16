import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { adminDb } from "./client";

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

  it("audit_log has no UPDATE or DELETE grant for the app role", async () => {
    const rows = await adminDb.execute<{ privilege_type: string }>(sql`
      select privilege_type from information_schema.role_table_grants
      where table_name = 'audit_log' and grantee = 'dentalpms_app'
        and privilege_type in ('UPDATE', 'DELETE')
    `);
    expect(rows).toEqual([]);
  });
});
