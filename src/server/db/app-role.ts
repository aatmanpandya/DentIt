/**
 * Password for the dentit_app role that request-scoped queries connect as (tenant.ts).
 * rls.sql used to create it with a password hard-coded in the file, so every database —
 * production included — had a publicly known app password. It now comes from the same
 * DATABASE_URL_APP the app connects with; outside production a missing value falls back to
 * the local development password, and production refuses that default outright.
 * docs/bug-log.md entry 22.
 */
const DEV_PASSWORD = "dentit_app_dev";

export function appRolePassword(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL_APP;
  const fromUrl = url ? decodeURIComponent(new URL(url).password) : "";
  const isProduction = env.NODE_ENV === "production";

  if (isProduction && !fromUrl) throw new Error("DATABASE_URL_APP must carry the dentit_app password in production.");
  if (isProduction && fromUrl === DEV_PASSWORD) throw new Error("Refusing to use the development password for dentit_app in production.");
  return fromUrl || DEV_PASSWORD;
}

/** Quotes a value as a Postgres string literal (the role DDL can't take bind parameters). */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
