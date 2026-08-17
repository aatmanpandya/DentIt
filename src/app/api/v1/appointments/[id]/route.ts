import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeAppointment } from "@/server/lib/serialize-appointments";
import { updateAppointmentSchema } from "@/server/schemas/appointments";
import {
  getAppointment,
  updateAppointment,
  AppointmentNotFoundError,
  OperatoryNotFoundError,
  ProviderNotFoundError,
  AppointmentConflictError,
  AppointmentOutsideHoursError,
  AppointmentBlockedPeriodError,
  AppointmentProviderConflictError,
} from "@/server/services/appointments";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const appt = await getAppointment(actor, id);
    return NextResponse.json(serializeAppointment(appt));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view the schedule.");
    if (err instanceof AppointmentNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}

// Time, operatory, provider, note only — status changes go through /transition, never
// PATCH. See docs/specs/api-surface.md.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updateAppointmentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the appointment details.", parsed.error.issues);
    }

    const appt = await updateAppointment(actor, id, parsed.data);
    return NextResponse.json(serializeAppointment(appt));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit appointments.");
    if (err instanceof AppointmentNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof OperatoryNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof ProviderNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof AppointmentConflictError) return errorResponse(409, "APPOINTMENT_CONFLICT", err.message);
    if (err instanceof AppointmentOutsideHoursError) return errorResponse(422, "APPOINTMENT_OUTSIDE_HOURS", err.message);
    if (err instanceof AppointmentBlockedPeriodError) return errorResponse(422, "APPOINTMENT_BLOCKED_PERIOD", err.message);
    if (err instanceof AppointmentProviderConflictError) return errorResponse(422, "APPOINTMENT_PROVIDER_CONFLICT", err.message);
    throw err;
  }
}
