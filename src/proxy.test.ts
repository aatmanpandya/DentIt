import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const call = (path: string) => proxy(new NextRequest(`http://localhost:3000${path}`));
const UUID = "362d507b-4d5e-4b47-b5e2-ac8ddf2a1196";

// docs/bug-log.md entry 35: a non-uuid id reached Postgres and came back as a 500.
describe("proxy: malformed API ids", () => {
  it.each(["/api/v1/patients/abc", "/api/v1/patients/1/chart", "/api/v1/perio-exams/%27/teeth/18", "/api/v1/notes/x/sign"])("404s %s", async (path) => {
    const res = call(path);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it.each([
    `/api/v1/patients/${UUID}`,
    `/api/v1/patients/${UUID.toUpperCase()}/ledger`,
    "/api/v1/patients",
    "/api/v1/payments/apply-credit",
    "/api/v1/invoices/suggest-location",
    "/api/v1/perio-exams/providers",
    "/api/v1/procedure-codes/import-starter",
    "/api/v1/auth/login",
  ])("lets %s through", (path) => {
    expect(call(path).headers.get("x-middleware-next")).toBe("1");
  });
});
