import { eq, and, isNull } from "drizzle-orm";
import { adminDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifyPassword } from "@/server/lib/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/server/lib/jwt";
import { writeAudit } from "./audit";
import { randomUUID } from "node:crypto";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountLockedError extends Error {
  constructor(public until: Date) {
    super(`Account is locked until ${until.toISOString()}.`);
    this.name = "AccountLockedError";
  }
}

/**
 * Login uses adminDb (not a tenant-scoped connection) because at this point we don't
 * yet know the organization — email lookup is what determines it. Every subsequent
 * request uses dbForRequest() scoped to the org from the resulting token.
 */
export async function login(email: string, password: string, ip: string | null) {
  const [user] = await adminDb
    .select()
    .from(users)
    .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
    .limit(1);

  // isActive exists specifically to disable an account without deleting it (e.g. an
  // employee who left). refresh() already checked this; login() must too, or a
  // deactivated user could still start a brand new session.
  if (!user || !user.passwordHash || !user.isActive) {
    throw new InvalidCredentialsError();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AccountLockedError(user.lockedUntil);
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    const failedCount = user.failedLoginCount + 1;
    const lockedUntil =
      failedCount >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
        : null;

    await adminDb
      .update(users)
      .set({ failedLoginCount: failedCount, lockedUntil })
      .where(eq(users.id, user.id));

    await writeAudit(adminDb, { organizationId: user.organizationId, actorUserId: user.id, actorIp: ip }, {
      entityType: "user",
      entityId: user.id,
      action: lockedUntil ? "lockout" : "login_failed",
    });

    if (lockedUntil) throw new AccountLockedError(lockedUntil);
    throw new InvalidCredentialsError();
  }

  await adminDb
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  await writeAudit(adminDb, { organizationId: user.organizationId, actorUserId: user.id, actorIp: ip }, {
    entityType: "user",
    entityId: user.id,
    action: "login",
  });

  const sessionStartedAt = Math.floor(Date.now() / 1000);
  const accessToken = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sessionStartedAt,
  });
  const refreshToken = await signRefreshToken({ sub: user.id, jti: randomUUID() });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role, organizationId: user.organizationId },
  };
}

export async function refresh(refreshToken: string) {
  const claims = await verifyRefreshToken(refreshToken);
  const [user] = await adminDb.select().from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!user || !user.isActive || user.deletedAt) throw new InvalidCredentialsError();

  const sessionStartedAt = Math.floor(Date.now() / 1000);
  const accessToken = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sessionStartedAt,
  });
  const newRefreshToken = await signRefreshToken({ sub: user.id, jti: randomUUID() });

  return { accessToken, refreshToken: newRefreshToken };
}
