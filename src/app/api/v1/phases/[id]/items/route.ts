import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeTreatmentPlanItem } from "@/server/lib/serialize-treatment-plans";
import { addItemSchema } from "@/server/schemas/treatment-plans";
import {
  addItemToPhase,
  TreatmentPlanPhaseNotFoundError,
  TreatmentPlanNotFoundError,
  TreatmentPlanLockedError,
  TreatmentPlanItemNotPlannedError,
  ProcedureCodeNotFoundError,
  InvalidToothError,
  ProcedureScopeMismatchError,
  ProcedureInvalidSurfaceError,
} from "@/server/services/treatment-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = addItemSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the procedure to add.", parsed.error.issues);
    }

    const item = await addItemToPhase(actor, id, parsed.data);
    return NextResponse.json(serializeTreatmentPlanItem(item), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to build treatment plans.");
    if (err instanceof TreatmentPlanPhaseNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof TreatmentPlanNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof TreatmentPlanLockedError) return errorResponse(422, "TREATMENT_PLAN_LOCKED", err.message);
    if (err instanceof TreatmentPlanItemNotPlannedError) return errorResponse(422, "TREATMENT_PLAN_ITEM_NOT_PLANNED", err.message);
    if (err instanceof ProcedureCodeNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof InvalidToothError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    if (err instanceof ProcedureScopeMismatchError) return errorResponse(422, "PROCEDURE_SCOPE_MISMATCH", err.message);
    if (err instanceof ProcedureInvalidSurfaceError) return errorResponse(422, "PROCEDURE_INVALID_SURFACE", err.message);
    throw err;
  }
}
