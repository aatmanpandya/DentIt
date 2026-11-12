import { describe, it, expect } from "vitest";
import { appRolePassword } from "./app-role";

// The app role used to be created with a password hard-coded in rls.sql — in every
// environment, production included. docs/bug-log.md entry 22.
describe("appRolePassword", () => {
  it("takes the password from DATABASE_URL_APP", () => {
    expect(appRolePassword({ DATABASE_URL_APP: "postgres://dentit_app:s3cr%40t@db:5432/dentit" })).toBe("s3cr@t");
  });

  it("falls back to the local development password outside production", () => {
    expect(appRolePassword({ NODE_ENV: "development" })).toBe("dentit_app_dev");
  });

  it("refuses to run in production without an explicit password", () => {
    expect(() => appRolePassword({ NODE_ENV: "production" })).toThrow(/DATABASE_URL_APP/);
    expect(() => appRolePassword({ NODE_ENV: "production", DATABASE_URL_APP: "postgres://dentit_app:dentit_app_dev@db/dentit" })).toThrow(/development password/);
  });
});
