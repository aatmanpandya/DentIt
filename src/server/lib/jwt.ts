import { SignJWT, jwtVerify } from "jose";

/**
 * Access: 15 min. Refresh: 7 days, rotated on use. Idle timeout (30 min) and absolute
 * session (12h) are enforced by the caller comparing against session metadata, not by
 * the token's own expiry — see docs/specs/pilot-foundations.md §7.
 */
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

const accessSecret = () => new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
const refreshSecret = () => new TextEncoder().encode(process.env.JWT_REFRESH_SECRET!);

export interface AccessTokenClaims {
  sub: string; // user id
  org: string; // organization id — this is what dbForRequest() scopes on
  role: string;
  sessionStartedAt: number; // epoch seconds, for the 12h absolute-session check
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(accessSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, accessSecret());
  return payload as unknown as AccessTokenClaims;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string; // unique per issuance, so it can be revoked/rotated individually
}

export async function signRefreshToken(claims: RefreshTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
    .sign(refreshSecret());
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
  const { payload } = await jwtVerify(token, refreshSecret());
  return payload as unknown as RefreshTokenClaims;
}

export const SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60;
