import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePerioExam } from "@/server/lib/serialize-perio";
import { uncompletePerioExam, PerioExamNotFoundError } from "@/server/services/perio";

type RouteContext = { params: Promise<{ id: string }> };

// Not in the original api-surface.md endpoint list — added for the explicit un-complete
// decision in docs/specs/perio.md (there's no separate amend-exam path the way notes has
// amend-note; reopening a completed exam is a direct, audited transition back to draft).
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const exam = await uncompletePerioExam(actor, id);
    return NextResponse.json(serializePerioExam(exam));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to record perio.");
    if (err instanceof PerioExamNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
