import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users } from "@/server/db/schema";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import { signAccessToken } from "@/server/lib/jwt";
import type { Role } from "@/server/lib/permissions";

/**
 * Shared setup for route-handler tests — these call the exported GET/POST/etc.
 * functions directly with a real NextRequest rather than going through an HTTP
 * server, so what's under test is the thin route layer (auth wiring, validation,
 * status codes, snake_case serialisation), not the business logic already covered
 * by the service-layer tests these routes call into.
 */
export async function createTestOrgAndUser(orgName: string, role: Role = "front_desk") {
  const [org] = await adminDb.insert(organizations).values({ name: orgName }).returning();
  const [user] = await adminDb
    .insert(users)
    .values({
      organizationId: org.id,
      email: `route-test-${role}-${Math.random().toString(36).slice(2)}@example.test`,
      fullName: "Route Test User",
      role,
    })
    .returning();
  return { org, user };
}

export async function tokenFor(user: { id: string; organizationId: string; role: string }) {
  return signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sessionStartedAt: Math.floor(Date.now() / 1000),
  });
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function cleanupOrgsByName(name: string) {
  const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, name));
  for (const org of orgs) {
    await wipeOrganizationData(adminDb, org.id);
    await adminDb.delete(organizations).where(eq(organizations.id, org.id));
  }
}
