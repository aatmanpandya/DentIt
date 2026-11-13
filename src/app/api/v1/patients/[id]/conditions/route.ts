import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeCondition } from "@/server/lib/serialize-clinical";
import { createConditionSchema } from "@/server/schemas/clinical";
import { createCondition, PatientNotFoundError, InvalidToothError } from "@/server/services/chart";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = createConditionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the condition details.", parsed.error.issues);
    }

    const condition = await createCondition(actor, id, parsed.data);
    return NextResponse.json(serializeCondition(condition), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to chart.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof InvalidToothError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    throw err;
  }
}
