import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeTreatmentPlan, serializeTreatmentPlanDetail } from "@/server/lib/serialize-treatment-plans";
import { updateTreatmentPlanSchema } from "@/server/schemas/treatment-plans";
import {
  getTreatmentPlan,
  updateTreatmentPlan,
  TreatmentPlanNotFoundError,
  IllegalTreatmentPlanTransitionError,
  TreatmentPlanLockedError,
} from "@/server/services/treatment-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const detail = await getTreatmentPlan(actor, id);
    return NextResponse.json(serializeTreatmentPlanDetail(detail));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view treatment plans.");
    if (err instanceof TreatmentPlanNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}

// Double duty per docs/specs/treatment-planning.md, same convention as PATCH
// /procedures/:id: `to_status` (only `declined` reaches here) is a lifecycle
// transition, anything else is a content edit.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updateTreatmentPlanSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the plan details.", parsed.error.issues);
    }

    const plan = await updateTreatmentPlan(actor, id, parsed.data);
    return NextResponse.json(serializeTreatmentPlan(plan));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to build treatment plans.");
    if (err instanceof TreatmentPlanNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof IllegalTreatmentPlanTransitionError) return errorResponse(422, "TREATMENT_PLAN_ILLEGAL_TRANSITION", err.message);
    if (err instanceof TreatmentPlanLockedError) return errorResponse(422, "TREATMENT_PLAN_LOCKED", err.message);
    throw err;
  }
}
