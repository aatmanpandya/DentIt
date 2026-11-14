import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePerioExam } from "@/server/lib/serialize-perio";
import { uncompletePerioExam, PerioExamNotFoundError, PerioApprovalReasonRequiredError, PerioExamNotApprovedError } from "@/server/services/perio";

type RouteContext = { params: Promise<{ id: string }> };

// Reopens an approved exam for correction: approvers only, with a reason that goes in the
// exam's transcript (docs/specs/perio-approval.md).
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const exam = await uncompletePerioExam(actor, id, typeof body?.reason === "string" ? body.reason : "");
    return NextResponse.json(serializePerioExam(exam));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "Only a dentist or hygienist can reopen an approved exam.");
    if (err instanceof PerioExamNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof PerioApprovalReasonRequiredError) return errorResponse(422, "REASON_REQUIRED", err.message);
    if (err instanceof PerioExamNotApprovedError) return errorResponse(422, "PERIO_EXAM_NOT_APPROVED", err.message);
    throw err;
  }
}
