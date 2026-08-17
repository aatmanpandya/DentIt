import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { serializeProvider } from "@/server/lib/serialize-locations";
import { listProviders } from "@/server/services/locations";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const result = await listProviders(actor);
    return NextResponse.json({ data: result.map(serializeProvider) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    throw err;
  }
}
