import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { refresh, InvalidCredentialsError } from "@/server/services/auth";
import { errorResponse } from "@/server/lib/api-error";

const bodySchema = z.object({ refresh_token: z.string() });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null)); // malformed JSON → 400, not 500
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_FAILED", "Missing refresh token.");
  }

  try {
    const result = await refresh(parsed.data.refresh_token);
    return NextResponse.json({ access_token: result.accessToken, refresh_token: result.refreshToken });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return errorResponse(401, "AUTH_TOKEN_EXPIRED", "Your session has expired. Please log in again.");
    }
    throw err;
  }
}
