import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { serializeAppointmentType } from "@/server/lib/serialize-appointments";
import { listAppointmentTypes } from "@/server/services/appointments";

// Read-only for the pilot — appointment types are seeded, not editable through the
// API yet. See listAppointmentTypes in src/server/services/appointments.ts.
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const result = await listAppointmentTypes(actor);
    return NextResponse.json({ data: result.map(serializeAppointmentType) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    throw err;
  }
}
