import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeAppointment } from "@/server/lib/serialize-appointments";
import { rescheduleAppointmentSchema } from "@/server/schemas/appointments";
import {
  rescheduleAppointment,
  AppointmentNotFoundError,
  OperatoryNotFoundError,
  ProviderNotFoundError,
  AppointmentConflictError,
  AppointmentOutsideHoursError,
  AppointmentBlockedPeriodError,
  AppointmentProviderConflictError,
  IllegalTransitionError,
} from "@/server/services/appointments";

type RouteContext = { params: Promise<{ id: string }> };

// Creates a new appointment and cancels the original — distinct from PATCH, which
// edits the same row in place. See docs/specs/api-surface.md.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = rescheduleAppointmentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the new time and operatory.", parsed.error.issues);
    }

    const appt = await rescheduleAppointment(actor, id, parsed.data);
    return NextResponse.json(serializeAppointment(appt), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to reschedule appointments.");
    if (err instanceof AppointmentNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof OperatoryNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof ProviderNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof AppointmentConflictError) return errorResponse(409, "APPOINTMENT_CONFLICT", err.message);
    if (err instanceof AppointmentOutsideHoursError) return errorResponse(422, "APPOINTMENT_OUTSIDE_HOURS", err.message);
    if (err instanceof AppointmentBlockedPeriodError) return errorResponse(422, "APPOINTMENT_BLOCKED_PERIOD", err.message);
    if (err instanceof AppointmentProviderConflictError) return errorResponse(422, "APPOINTMENT_PROVIDER_CONFLICT", err.message);
    if (err instanceof IllegalTransitionError) return errorResponse(422, "APPOINTMENT_ILLEGAL_TRANSITION", err.message);
    throw err;
  }
}
