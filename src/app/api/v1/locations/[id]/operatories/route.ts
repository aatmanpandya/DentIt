import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { serializeOperatory } from "@/server/lib/serialize-locations";
import { listOperatories, LocationNotFoundError } from "@/server/services/locations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const result = await listOperatories(actor, id);
    return NextResponse.json({ data: result.map(serializeOperatory) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof LocationNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
