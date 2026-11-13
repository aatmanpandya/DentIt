import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePerioExam } from "@/server/lib/serialize-perio";
import { createPerioExamSchema } from "@/server/schemas/perio";
import { listPatientPerioExams, createPerioExam, PatientNotFoundError, InvalidProviderError } from "@/server/services/perio";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const exams = await listPatientPerioExams(actor, id);
    return NextResponse.json({ data: exams.map(serializePerioExam) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view perio exams.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = createPerioExamSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the exam details.", parsed.error.issues);
    }

    const exam = await createPerioExam(actor, id, parsed.data);
    return NextResponse.json(serializePerioExam(exam), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to record perio.");
    if (err instanceof PatientNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof InvalidProviderError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    throw err;
  }
}
