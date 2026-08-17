import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { serializeProviderSchedule } from "@/server/lib/serialize-locations";
import { listProviderScheduleQuerySchema } from "@/server/schemas/appointments";
import { listProviderSchedule, ProviderNotFoundError } from "@/server/services/locations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = listProviderScheduleQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await listProviderSchedule(actor, id, parsed.data.location_id);
    return NextResponse.json({ data: result.map(serializeProviderSchedule) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof ProviderNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
