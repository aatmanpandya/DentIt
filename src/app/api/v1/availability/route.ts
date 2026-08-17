import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { getAvailabilityQuerySchema } from "@/server/schemas/appointments";
import { getAvailability, ProviderNotFoundError } from "@/server/services/appointments";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = getAvailabilityQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await getAvailability(actor, {
      location_id: parsed.data.location_id,
      provider_id: parsed.data.provider_id,
      date: parsed.data.date,
      duration_minutes: parsed.data.duration,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view the schedule.");
    if (err instanceof ProviderNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
