import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePerioToothRecord } from "@/server/lib/serialize-perio";
import { upsertPerioToothRecordSchema } from "@/server/schemas/perio";
import {
  upsertPerioToothRecord,
  PerioExamNotFoundError,
  PerioExamCompletedError,
  InvalidToothError,
  InvalidFurcationError,
} from "@/server/services/perio";

type RouteContext = { params: Promise<{ id: string; tooth: string }> };

/**
 * The load-bearing endpoint of the whole product — docs/specs/api-surface.md. Fires once
 * per tooth as the operator advances; must stay fast and idempotent. See
 * docs/specs/validation-and-errors.md for the perio grid's failure-handling exception —
 * the client, not this route, owns the retry-queue behavior on a failed call.
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id, tooth } = await params;

    const parsed = upsertPerioToothRecordSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the measurements.", parsed.error.issues);
    }

    const { record, sites } = await upsertPerioToothRecord(actor, id, tooth, parsed.data);
    return NextResponse.json(serializePerioToothRecord(record, sites));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to record perio.");
    if (err instanceof PerioExamNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof PerioExamCompletedError) return errorResponse(422, "PERIO_EXAM_COMPLETED", err.message);
    if (err instanceof InvalidToothError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    if (err instanceof InvalidFurcationError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    throw err;
  }
}
