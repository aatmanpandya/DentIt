import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeTreatmentPlan, serializeTreatmentPlanDetail } from "@/server/lib/serialize-treatment-plans";
import { createTreatmentPlanSchema } from "@/server/schemas/treatment-plans";
import { listPatientTreatmentPlans, createTreatmentPlan, PatientNotFoundError } from "@/server/services/treatment-plans";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const plans = await listPatientTreatmentPlans(actor, id);
    return NextResponse.json({ data: plans.map(serializeTreatmentPlan) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view treatment plans.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = createTreatmentPlanSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the plan details.", parsed.error.issues);
    }

    const detail = await createTreatmentPlan(actor, id, parsed.data);
    return NextResponse.json(serializeTreatmentPlanDetail(detail), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to build treatment plans.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
