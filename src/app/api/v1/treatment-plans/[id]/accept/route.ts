import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeTreatmentPlan } from "@/server/lib/serialize-treatment-plans";
import { acceptTreatmentPlanSchema } from "@/server/schemas/treatment-plans";
import {
  acceptTreatmentPlan,
  TreatmentPlanNotFoundError,
  IllegalTreatmentPlanTransitionError,
  TreatmentPlanEmptyError,
  TreatmentPlanItemNotPlannedError,
  FeeScheduleNoPriceError,
} from "@/server/services/treatment-plans";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Snapshots price onto every item's charted_procedure and bulk-transitions them
 * planned -> accepted, atomically — see docs/specs/treatment-planning.md's "Pricing"
 * section. `FEE_SCHEDULE_NO_PRICE` here means at least one item has no price in the
 * current fee schedule; the whole accept rolled back, nothing was partially applied.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = acceptTreatmentPlanSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the signature.", parsed.error.issues);
    }

    const plan = await acceptTreatmentPlan(actor, id, parsed.data);
    return NextResponse.json(serializeTreatmentPlan(plan));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to build treatment plans.");
    if (err instanceof TreatmentPlanNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof IllegalTreatmentPlanTransitionError) return errorResponse(422, "TREATMENT_PLAN_ILLEGAL_TRANSITION", err.message);
    if (err instanceof TreatmentPlanEmptyError) return errorResponse(422, "TREATMENT_PLAN_EMPTY", err.message);
    if (err instanceof TreatmentPlanItemNotPlannedError) return errorResponse(422, "TREATMENT_PLAN_ITEM_NOT_PLANNED", err.message);
    if (err instanceof FeeScheduleNoPriceError) return errorResponse(422, "FEE_SCHEDULE_NO_PRICE", err.message);
    throw err;
  }
}
