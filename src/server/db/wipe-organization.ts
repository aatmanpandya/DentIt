import { sql } from "drizzle-orm";
import type { Database } from "./client";

/**
 * Deletes every row belonging to one organization, across every table that has an
 * organization_id column. Used by the seed script's idempotent re-run and by nothing
 * else — this is a destructive admin operation, never exposed to a request.
 *
 * Table names come from information_schema, not user input, but a Postgres DO $$ block
 * cannot receive bind parameters at all (no $1 inside an anonymous code block) — that
 * was the original bug here. Looping in JS and issuing one parameterized DELETE per
 * table keeps the organizationId properly bound instead.
 *
 * information_schema doesn't return tables in FK-dependency order (a second bug found
 * writing the regression test for the first one — deleting `locations` before
 * `operatories` fails with a foreign key violation). Rather than hand-maintain a
 * dependency graph across ~30 tables that will keep growing, each pass deletes whatever
 * it can and defers tables that still have dependents; repeating until a pass makes no
 * progress. Safe to retry — deleting an already-empty set is a no-op.
 */
export async function wipeOrganizationData(db: Database, organizationId: string): Promise<void> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where column_name = 'organization_id' and table_schema = 'public'
  `);

  // user_location_access has no organization_id but references this org's users and
  // locations; clear it first or those two can never be deleted (bug-log entry 21).
  await db.execute(sql`
    delete from user_location_access
    where user_id in (select id from users where organization_id = ${organizationId})
  `);

  let remaining = tables.map((t) => t.table_name);

  while (remaining.length > 0) {
    const stillBlocked: string[] = [];

    for (const tableName of remaining) {
      try {
        await db.execute(sql`delete from ${sql.raw(`"${tableName}"`)} where organization_id = ${organizationId}`);
      } catch {
        stillBlocked.push(tableName);
      }
    }

    if (stillBlocked.length === remaining.length) {
      throw new Error(
        `wipeOrganizationData made no progress on: ${stillBlocked.join(", ")} — a foreign key cycle or a ` +
          `dependency outside these tables is blocking deletion.`,
      );
    }

    remaining = stillBlocked;
  }
}
