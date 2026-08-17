import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeProcedure } from "@/server/lib/serialize-clinical";
import { completeProcedure, ProcedureNotFoundError, IllegalProcedureTransitionError } from "@/server/services/chart";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const procedure = await completeProcedure(actor, id);
    return NextResponse.json(serializeProcedure(procedure));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to chart.");
    if (err instanceof ProcedureNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof IllegalProcedureTransitionError) return errorResponse(422, "PROCEDURE_ILLEGAL_TRANSITION", err.message);
    throw err;
  }
}
