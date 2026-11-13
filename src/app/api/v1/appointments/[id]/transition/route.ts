import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeAppointment } from "@/server/lib/serialize-appointments";
import { transitionAppointmentSchema } from "@/server/schemas/appointments";
import { transitionAppointment, AppointmentNotFoundError, IllegalTransitionError } from "@/server/services/appointments";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = transitionAppointmentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the status change.", parsed.error.issues);
    }

    const appt = await transitionAppointment(actor, id, parsed.data);
    return NextResponse.json(serializeAppointment(appt));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to change appointment status.");
    if (err instanceof AppointmentNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof IllegalTransitionError) return errorResponse(422, "APPOINTMENT_ILLEGAL_TRANSITION", err.message);
    throw err;
  }
}
