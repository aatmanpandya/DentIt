import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { organizations, users } from "@/server/db/schema";
import { hashPassword } from "@/server/lib/password";
import { wipeOrganizationData } from "@/server/db/wipe-organization";
import { login, refresh, InvalidCredentialsError, AccountLockedError } from "./auth";
import { verifyAccessToken, signRefreshToken } from "@/server/lib/jwt";

const PASSWORD = "CorrectHorseBattery9";

async function createTestOrgAndUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [org] = await adminDb.insert(organizations).values({ name: "__auth_test_org" }).returning();
  const passwordHash = await hashPassword(PASSWORD);
  const [user] = await adminDb
    .insert(users)
    .values({
      organizationId: org.id,
      email: "authtest@example.test",
      passwordHash,
      fullName: "Auth Test",
      role: "provider",
      ...overrides,
    })
    .returning();
  return { org, user };
}

describe("login", () => {
  afterEach(async () => {
    // Rows depend on the org via FK (users, audit_log from writeAudit), so it must be
    // wiped before the org itself can be deleted — leftover rows from a failed cleanup
    // would otherwise leak into the next test via the shared email address.
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, "__auth_test_org"));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("rejects a deactivated user even with the correct password", async () => {
    // Bug: login() never checked isActive, while refresh() did — a deactivated
    // account (e.g. an employee who left) could still start a brand new session.
    // isActive exists specifically to disable an account without deleting it.
    await createTestOrgAndUser({ isActive: false });

    await expect(login("authtest@example.test", PASSWORD, null)).rejects.toThrow(InvalidCredentialsError);
  });

  it("accepts an active user with the correct password", async () => {
    await createTestOrgAndUser({ isActive: true });

    const result = await login("authtest@example.test", PASSWORD, null);
    expect(result.user.email).toBe("authtest@example.test");
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it("rejects the wrong password", async () => {
    await createTestOrgAndUser();
    await expect(login("authtest@example.test", "wrong-password-entirely", null)).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it("locks the account after 5 failed attempts", async () => {
    await createTestOrgAndUser();

    for (let i = 0; i < 4; i++) {
      await expect(login("authtest@example.test", "wrong", null)).rejects.toThrow(InvalidCredentialsError);
    }
    // 5th failure crosses the threshold and locks the account.
    await expect(login("authtest@example.test", "wrong", null)).rejects.toThrow(AccountLockedError);

    // Even the correct password is now rejected while locked.
    await expect(login("authtest@example.test", PASSWORD, null)).rejects.toThrow(AccountLockedError);
  });

  it("resets the failed-attempt counter on a successful login", async () => {
    const { user } = await createTestOrgAndUser();

    await expect(login("authtest@example.test", "wrong", null)).rejects.toThrow(InvalidCredentialsError);
    await login("authtest@example.test", PASSWORD, null);

    const [refreshed] = await adminDb.select().from(users).where(eq(users.id, user.id));
    expect(refreshed.failedLoginCount).toBe(0);
    expect(refreshed.lockedUntil).toBeNull();
  });

  it("rejects a soft-deleted user", async () => {
    await createTestOrgAndUser({ deletedAt: new Date() });
    await expect(login("authtest@example.test", PASSWORD, null)).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects an unknown email without revealing whether the account exists", async () => {
    await expect(login("nobody-at-all@example.test", PASSWORD, null)).rejects.toThrow(InvalidCredentialsError);
  });
});

// docs/bug-log.md entries 19–20.
describe("session and lockout review fixes", () => {
  afterEach(async () => {
    const orgs = await adminDb.select().from(organizations).where(eq(organizations.name, "__auth_test_org"));
    for (const org of orgs) {
      await wipeOrganizationData(adminDb, org.id);
      await adminDb.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it("keeps the original session start across a refresh, so the 12h cap can't be reset", async () => {
    await createTestOrgAndUser();
    const first = await login("authtest@example.test", PASSWORD, null);
    const started = (await verifyAccessToken(first.accessToken)).sessionStartedAt;
    await new Promise((r) => setTimeout(r, 1100));

    const refreshed = await refresh(first.refreshToken);

    expect((await verifyAccessToken(refreshed.accessToken)).sessionStartedAt).toBe(started);
  });

  it("refuses to refresh a session older than 12 hours", async () => {
    const { user } = await createTestOrgAndUser();
    const thirteenHoursAgo = Math.floor(Date.now() / 1000) - 13 * 60 * 60;
    const token = await signRefreshToken({ sub: user.id, jti: "x", sessionStartedAt: thirteenHoursAgo });
    await expect(refresh(token)).rejects.toThrow(InvalidCredentialsError);
  });

  it("treats a garbage or tampered refresh token as a normal auth failure", async () => {
    await expect(refresh("not-a-jwt")).rejects.toThrow(InvalidCredentialsError);
  });

  it("starts the failed-attempt count again once a lockout has expired", async () => {
    await createTestOrgAndUser({ failedLoginCount: 5, lockedUntil: new Date(Date.now() - 60_000) });
    // One wrong password after the lock expired is attempt 1, not attempt 6.
    await expect(login("authtest@example.test", "wrong", null)).rejects.toThrow(InvalidCredentialsError);
    await expect(login("authtest@example.test", PASSWORD, null)).resolves.toBeTruthy();
  });
});
