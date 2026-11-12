import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeOrganizationTreatmentPlanRow } from "@/server/lib/serialize-treatment-plans";
import { listTreatmentPlansQuerySchema } from "@/server/schemas/treatment-plans";
import { listOrganizationTreatmentPlans } from "@/server/services/treatment-plans";

/** Org-wide plan list for the side rail's "Treatment plans" page. `?status=` filters. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = listTreatmentPlansQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the status filter.", parsed.error.issues);
    }

    const rows = await listOrganizationTreatmentPlans(actor, { status: parsed.data.status });
    return NextResponse.json({ data: rows.map(serializeOrganizationTreatmentPlanRow) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view treatment plans.");
    throw err;
  }
}
