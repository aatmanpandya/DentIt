import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

// Standalone script, no Next.js .env.local loader available. Same guard as db/client.ts.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local — fine in CI/production, where the platform injects real env vars
  }
}

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  console.log("Running schema migrations...");
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });

  console.log("Applying RLS policies and constraints...");
  const rls = readFileSync(join(process.cwd(), "src/server/db/rls.sql"), "utf-8");
  await client.unsafe(rls);

  console.log("Done.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
