import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Every request-scoped query goes through here. The connection is opened per-request,
 * the org GUC is set inside the SAME transaction/session as the query, and the pool
 * connects as `dentit_app` — a role with no BYPASSRLS. A forgotten WHERE clause
 * leaks nothing. See docs/specs/data-model.md and docs/adr/ for the RLS design.
 *
 * Do not reuse a pooled connection across requests with different organizationId —
 * `postgres()` with max:1 here forces a fresh session per call so the GUC can't leak
 * between tenants. This trades connection reuse for correctness; revisit with a
 * transaction-scoped SET LOCAL if pilot load ever makes this a bottleneck.
 */
export async function dbForRequest<T>(
  organizationId: string,
  fn: (tx: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const client = postgres(process.env.DATABASE_URL_APP!, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${organizationId}, true)`);
      return fn(tx as unknown as ReturnType<typeof drizzle<typeof schema>>);
    });
  } finally {
    await client.end();
  }
}
