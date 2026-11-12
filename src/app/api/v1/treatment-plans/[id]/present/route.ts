import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeTreatmentPlan } from "@/server/lib/serialize-treatment-plans";
import {
  presentTreatmentPlan,
  TreatmentPlanNotFoundError,
  IllegalTreatmentPlanTransitionError,
  TreatmentPlanEmptyError,
} from "@/server/services/treatment-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const plan = await presentTreatmentPlan(actor, id);
    return NextResponse.json(serializeTreatmentPlan(plan));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to build treatment plans.");
    if (err instanceof TreatmentPlanNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof IllegalTreatmentPlanTransitionError) return errorResponse(422, "TREATMENT_PLAN_ILLEGAL_TRANSITION", err.message);
    if (err instanceof TreatmentPlanEmptyError) return errorResponse(422, "TREATMENT_PLAN_EMPTY", err.message);
    throw err;
  }
}
