import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// `next dev` loads .env.local on its own; this module is also imported by standalone
// tsx scripts (seed/index.ts) that have no such loader. CI/production set real env
// vars and have no .env.local file at all, hence the guard.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local — fine in CI/production, where the platform injects real env vars
  }
}

/**
 * Admin connection — migrations and seeding only. Bypasses RLS (superuser-ish role).
 * Request-scoped code must use `dbForRequest()` in ./tenant.ts instead, which connects
 * as the non-BYPASSRLS `dentalpms_app` role. See docs/specs/data-model.md.
 */
const adminClient = postgres(process.env.DATABASE_URL!, { max: 5 });
export const adminDb = drizzle(adminClient, { schema });

export type Database = typeof adminDb;
