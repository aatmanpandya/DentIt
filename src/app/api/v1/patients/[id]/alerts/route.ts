import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePatientAlert } from "@/server/lib/serialize-patient";
import { createPatientAlertSchema } from "@/server/schemas/patients";
import { listPatientAlerts, createPatientAlert, PatientNotFoundError } from "@/server/services/patients";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const alerts = await listPatientAlerts(actor, id);
    return NextResponse.json({ data: alerts.map(serializePatientAlert) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view patients.");
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = createPatientAlertSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the alert details.", parsed.error.issues);
    }

    const alert = await createPatientAlert(actor, id, parsed.data);
    return NextResponse.json(serializePatientAlert(alert), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit patients.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", "Patient not found.");
    throw err;
  }
}
