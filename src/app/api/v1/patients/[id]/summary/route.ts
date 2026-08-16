import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePatientAlert } from "@/server/lib/serialize-patient";
import { getPatientSummary, PatientNotFoundError } from "@/server/services/patients";

type RouteContext = { params: Promise<{ id: string }> };

// One request for the chart header — see docs/specs/api-surface.md: "the most-called
// endpoint in the product; keep it fast and denormalised."
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const summary = await getPatientSummary(actor, id);

    return NextResponse.json({
      alerts: summary.alerts.map(serializePatientAlert),
      next_appointment: summary.nextAppointment
        ? {
            id: summary.nextAppointment.id,
            starts_at: summary.nextAppointment.startsAt.toISOString(),
            status: summary.nextAppointment.status,
          }
        : null,
      last_visit_at: summary.lastVisitAt ? summary.lastVisitAt.toISOString() : null,
      balance: summary.balance,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view patients.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", "Patient not found.");
    throw err;
  }
}
