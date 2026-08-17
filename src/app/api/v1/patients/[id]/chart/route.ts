import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeCondition, serializeProcedure } from "@/server/lib/serialize-clinical";
import { getPatientChart, PatientNotFoundError } from "@/server/services/chart";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const { conditions, procedures } = await getPatientChart(actor, id);
    return NextResponse.json({
      conditions: conditions.map(serializeCondition),
      procedures: procedures.map(serializeProcedure),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view the chart.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
