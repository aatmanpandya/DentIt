import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeTreatmentPlanPhase } from "@/server/lib/serialize-treatment-plans";
import { reorderSchema } from "@/server/schemas/treatment-plans";
import {
  reorderPhase,
  TreatmentPlanPhaseNotFoundError,
  TreatmentPlanNotFoundError,
  TreatmentPlanLockedError,
} from "@/server/services/treatment-plans";

type RouteContext = { params: Promise<{ id: string }> };

// Not in the original api-surface.md list — added for drag-to-reorder, per
// docs/specs/treatment-planning.md.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = reorderSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the new position.", parsed.error.issues);
    }

    const phase = await reorderPhase(actor, id, parsed.data.sequence);
    return NextResponse.json(serializeTreatmentPlanPhase(phase));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to build treatment plans.");
    if (err instanceof TreatmentPlanPhaseNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof TreatmentPlanNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof TreatmentPlanLockedError) return errorResponse(422, "TREATMENT_PLAN_LOCKED", err.message);
    throw err;
  }
}
