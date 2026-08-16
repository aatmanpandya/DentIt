import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePatient } from "@/server/lib/serialize-patient";
import { updatePatientSchema } from "@/server/schemas/patients";
import { getPatient, updatePatient, deletePatient, PatientNotFoundError } from "@/server/services/patients";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const patient = await getPatient(actor, id);
    return NextResponse.json(serializePatient(patient));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view patients.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", "Patient not found.");
    throw err;
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updatePatientSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the patient details.", parsed.error.issues);
    }

    const patient = await updatePatient(actor, id, parsed.data);
    return NextResponse.json(serializePatient(patient));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit patients.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", "Patient not found.");
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    await deletePatient(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "Only an owner or admin can delete a patient.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", "Patient not found.");
    throw err;
  }
}
