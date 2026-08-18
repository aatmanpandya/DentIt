import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeNote } from "@/server/lib/serialize-clinical";
import { signNote, NoteNotFoundError, NoteAlreadySignedError } from "@/server/services/notes";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const note = await signNote(actor, id);
    return NextResponse.json(serializeNote(note));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to sign clinical notes.");
    if (err instanceof NoteNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof NoteAlreadySignedError) return errorResponse(422, "NOTE_ALREADY_SIGNED", err.message);
    throw err;
  }
}
