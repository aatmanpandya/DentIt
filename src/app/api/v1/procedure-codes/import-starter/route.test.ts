import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { procedureCodes } from "@/server/db/schema";
import { createTestOrgAndUser, tokenFor, authHeaders, cleanupOrgsByName } from "@/server/testing/route-test-support";
import { GET } from "../route";
import { POST } from "./route";

const ORG_NAME = "__procedure_codes_import_starter_route_test";
const STARTER_CODE_PREFIX = "RTSTARTER-";

async function insertStarterRow(code: string) {
  const [row] = await adminDb
    .insert(procedureCodes)
    .values({ organizationId: null, code, shortName: `Starter ${code}`, category: "diagnostic", appliesTo: "mouth" })
    .returning();
  return row;
}

describe("POST /api/v1/procedure-codes/import-starter", () => {
  afterEach(async () => {
    await cleanupOrgsByName(ORG_NAME);
    const starterRows = await adminDb
      .select({ id: procedureCodes.id, code: procedureCodes.code })
      .from(procedureCodes)
      .where(isNull(procedureCodes.organizationId));
    for (const row of starterRows) {
      if (row.code.startsWith(STARTER_CODE_PREFIX)) {
        await adminDb.delete(procedureCodes).where(eq(procedureCodes.id, row.id));
      }
    }
  });

  it("401s without a token", async () => {
    const req = new NextRequest("http://localhost/api/v1/procedure-codes/import-starter", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("copies the starter template into the org and the codes then appear in the list", async () => {
    await insertStarterRow(`${STARTER_CODE_PREFIX}1`);
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "owner");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes/import-starter", { method: "POST", headers: authHeaders(token) }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.some((c: { code: string }) => c.code === `${STARTER_CODE_PREFIX}1`)).toBe(true);

    // The real starter template has 70+ rows (migration 0006), past the list route's
    // default page size — search by the test's own code prefix instead of paging.
    const listRes = await GET(
      new NextRequest(`http://localhost/api/v1/procedure-codes?q=${STARTER_CODE_PREFIX}`, { headers: authHeaders(token) }),
    );
    const listBody = await listRes.json();
    expect(listBody.data.some((c: { code: string }) => c.code === `${STARTER_CODE_PREFIX}1`)).toBe(true);
  });

  it("403s when the actor's role can't write the catalog", async () => {
    const { org, user } = await createTestOrgAndUser(ORG_NAME, "hygienist");
    const token = await tokenFor({ id: user.id, organizationId: org.id, role: user.role });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/procedure-codes/import-starter", { method: "POST", headers: authHeaders(token) }),
    );
    expect(res.status).toBe(403);
  });
});
