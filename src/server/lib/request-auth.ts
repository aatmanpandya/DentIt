import { NextRequest } from "next/server";
import { verifyAccessToken, SESSION_ABSOLUTE_TIMEOUT_SECONDS, type AccessTokenClaims } from "./jwt";
import type { Role } from "./permissions";

export class UnauthenticatedError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session timed out. Please sign in again.");
    this.name = "SessionExpiredError";
  }
}

export interface RequestActor {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * Every authenticated route calls this first. Enforces the 12h absolute session cap
 * on top of the access token's own 15-min expiry — see docs/specs/pilot-foundations.md §7.
 * Idle timeout (30 min) is enforced client-side by the token's short TTL forcing a
 * refresh; the refresh endpoint is where idle-vs-active is distinguished going forward.
 */
export async function requireAuth(req: NextRequest): Promise<RequestActor> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new UnauthenticatedError();

  let claims: AccessTokenClaims;
  try {
    claims = await verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    throw new UnauthenticatedError();
  }

  const sessionAgeSeconds = Math.floor(Date.now() / 1000) - claims.sessionStartedAt;
  if (sessionAgeSeconds > SESSION_ABSOLUTE_TIMEOUT_SECONDS) {
    throw new SessionExpiredError();
  }

  return { userId: claims.sub, organizationId: claims.org, role: claims.role as Role };
}
