import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeAppointment } from "@/server/lib/serialize-appointments";
import { createAppointmentSchema, listAppointmentsQuerySchema } from "@/server/schemas/appointments";
import {
  listAppointments,
  createAppointment,
  OperatoryNotFoundError,
  ProviderNotFoundError,
  AppointmentConflictError,
  AppointmentOutsideHoursError,
  AppointmentBlockedPeriodError,
  AppointmentProviderConflictError,
} from "@/server/services/appointments";
import { PatientNotFoundError } from "@/server/services/patients";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = listAppointmentsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await listAppointments(actor, parsed.data);
    return NextResponse.json({ data: result.map(serializeAppointment) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view the schedule.");
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = createAppointmentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the appointment details.", parsed.error.issues);
    }

    const appt = await createAppointment(actor, parsed.data);
    return NextResponse.json(serializeAppointment(appt), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to book appointments.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof OperatoryNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof ProviderNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof AppointmentConflictError) return errorResponse(409, "APPOINTMENT_CONFLICT", err.message);
    if (err instanceof AppointmentOutsideHoursError) return errorResponse(422, "APPOINTMENT_OUTSIDE_HOURS", err.message);
    if (err instanceof AppointmentBlockedPeriodError) return errorResponse(422, "APPOINTMENT_BLOCKED_PERIOD", err.message);
    if (err instanceof AppointmentProviderConflictError) return errorResponse(422, "APPOINTMENT_PROVIDER_CONFLICT", err.message);
    throw err;
  }
}
