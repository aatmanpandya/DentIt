import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePerioExam, serializePerioToothRecord } from "@/server/lib/serialize-perio";
import { updatePerioExamSchema } from "@/server/schemas/perio";
import { getPerioExam, updatePerioExamNotes, PerioExamNotFoundError } from "@/server/services/perio";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const { exam, teeth } = await getPerioExam(actor, id);
    return NextResponse.json({
      ...serializePerioExam(exam),
      teeth: teeth.map((t) => serializePerioToothRecord(t.record, t.sites)),
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view perio exams.");
    if (err instanceof PerioExamNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}

// Not in the original api-surface.md endpoint list — added for the exam-level notes field,
// which docs/specs/perio.md deliberately surfaces inline below the periochart rather than
// only at exam creation.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updatePerioExamSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the exam notes.", parsed.error.issues);
    }

    const exam = await updatePerioExamNotes(actor, id, parsed.data);
    return NextResponse.json(serializePerioExam(exam));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to record perio.");
    if (err instanceof PerioExamNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
