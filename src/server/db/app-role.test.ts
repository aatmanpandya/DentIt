import { describe, it, expect } from "vitest";
import { appRolePassword, sqlLiteral } from "./app-role";

// The app role used to be created with a password hard-coded in rls.sql — in every
// environment, production included. docs/bug-log.md entry 22.
describe("appRolePassword", () => {
  it("takes the password from DATABASE_URL_APP", () => {
    expect(appRolePassword({ DATABASE_URL_APP: "postgres://dentit_app:s3cr%40t@db:5432/dentit" })).toEqual({ password: "s3cr@t", fromEnv: true });
  });

  it("falls back to the local development password outside production", () => {
    // Not "from env": migrate then only uses it to create a missing role, never to reset one.
    expect(appRolePassword({ NODE_ENV: "development" })).toEqual({ password: "dentit_app_dev", fromEnv: false });
  });

  it("refuses to run in production without an explicit password", () => {
    expect(() => appRolePassword({ NODE_ENV: "production" })).toThrow(/DATABASE_URL_APP/);
    expect(() => appRolePassword({ NODE_ENV: "production", DATABASE_URL_APP: "postgres://dentit_app:dentit_app_dev@db/dentit" })).toThrow(/development password/);
  });

  it("explains a URL whose password isn't percent-encoded", () => {
    expect(() => appRolePassword({ DATABASE_URL_APP: "postgres://dentit_app:50%off@db/dentit" })).toThrow(/percent-encode/);
  });
});

// migrate.ts substitutes the password with a replacer function: a string replacement would
// expand "$$", "$&" etc. inside the password.
describe("sqlLiteral", () => {
  it("quotes single quotes and leaves dollar signs alone", () => {
    expect(sqlLiteral("a'b$$c$&")).toBe("'a''b$$c$&'");
    expect("X".replace("X", () => sqlLiteral("ab$$cd"))).toBe("'ab$$cd'");
  });
});
