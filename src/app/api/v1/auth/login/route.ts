import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login, InvalidCredentialsError, AccountLockedError } from "@/server/services/auth";
import { errorResponse } from "@/server/lib/api-error";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_FAILED", "Check your email and password.", parsed.error.issues);
  }

  const ip = req.headers.get("x-forwarded-for") ?? null;

  try {
    const result = await login(parsed.data.email, parsed.data.password, ip);
    // snake_case over the wire — see docs/specs/api-surface.md. The service layer
    // uses camelCase internally (matching Drizzle); routes translate at the boundary.
    return NextResponse.json({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      user: {
        id: result.user.id,
        full_name: result.user.fullName,
        email: result.user.email,
        role: result.user.role,
        organization_id: result.user.organizationId,
      },
    });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return errorResponse(401, "AUTH_INVALID_CREDENTIALS", "That email or password isn't right.");
    }
    if (err instanceof AccountLockedError) {
      return errorResponse(
        401,
        "AUTH_ACCOUNT_LOCKED",
        `Too many failed attempts. Try again after ${err.until.toLocaleTimeString()}.`,
      );
    }
    throw err;
  }
}
