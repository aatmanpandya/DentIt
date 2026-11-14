import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { recordPerioPhraseSchema } from "@/server/schemas/perio";
import { listPerioExamEvents, recordPerioPhrase, PerioExamNotFoundError, PerioExamCompletedError, type PerioChange } from "@/server/services/perio";
import { serializePerioExamEvent } from "@/server/lib/serialize-perio";

type RouteContext = { params: Promise<{ id: string }> };

function mapError(err: unknown) {
  if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
  if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
  if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to record perio.");
  if (err instanceof PerioExamNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
  if (err instanceof PerioExamCompletedError) return errorResponse(422, "PERIO_EXAM_COMPLETED", err.message);
  return null;
}

/** The exam's transcript, oldest first (docs/specs/perio-approval.md). */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const rows = await listPerioExamEvents(actor, id);
    return NextResponse.json({ data: rows.map((r) => serializePerioExamEvent(r.event, r.by)) });
  } catch (err) {
    const res = mapError(err);
    if (res) return res;
    throw err;
  }
}

/** Records one dictated phrase. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const parsed = recordPerioPhraseSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Check the phrase.", parsed.error.issues);
    const row = await recordPerioPhrase(actor, id, { ...parsed.data, changes: parsed.data.changes as PerioChange[] });
    return NextResponse.json(serializePerioExamEvent(row, null), { status: 201 });
  } catch (err) {
    const res = mapError(err);
    if (res) return res;
    throw err;
  }
}
