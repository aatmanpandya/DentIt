import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeCondition } from "@/server/lib/serialize-clinical";
import { updateConditionSchema } from "@/server/schemas/clinical";
import { updateCondition, ConditionNotFoundError } from "@/server/services/chart";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updateConditionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the condition details.", parsed.error.issues);
    }

    const condition = await updateCondition(actor, id, parsed.data);
    return NextResponse.json(serializeCondition(condition));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to chart.");
    if (err instanceof ConditionNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
