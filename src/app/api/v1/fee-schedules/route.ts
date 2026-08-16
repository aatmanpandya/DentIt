import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeFeeSchedule } from "@/server/lib/serialize-catalog";
import { createFeeScheduleSchema } from "@/server/schemas/catalog";
import { listFeeSchedules, createFeeSchedule } from "@/server/services/catalog";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const schedules = await listFeeSchedules(actor);
    return NextResponse.json({ data: schedules.map(serializeFeeSchedule) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view fee schedules.");
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = createFeeScheduleSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the fee schedule details.", parsed.error.issues);
    }

    const schedule = await createFeeSchedule(actor, parsed.data);
    return NextResponse.json(serializeFeeSchedule(schedule), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit fee schedules.");
    throw err;
  }
}
