import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Admin connection — migrations and seeding only. Bypasses RLS (superuser-ish role).
 * Request-scoped code must use `dbForRequest()` in ./tenant.ts instead, which connects
 * as the non-BYPASSRLS `dentalpms_app` role. See docs/specs/data-model.md.
 */
const adminClient = postgres(process.env.DATABASE_URL!, { max: 5 });
export const adminDb = drizzle(adminClient, { schema });

export type Database = typeof adminDb;
