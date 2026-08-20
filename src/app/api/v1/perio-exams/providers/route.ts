import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { listEligiblePerioProviders } from "@/server/services/perio";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const providers = await listEligiblePerioProviders(actor);
    return NextResponse.json({ data: providers.map((p) => ({ id: p.id, full_name: p.fullName, role: p.role })) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view perio providers.");
    throw err;
  }
}
