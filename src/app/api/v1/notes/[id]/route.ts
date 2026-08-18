import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeNote } from "@/server/lib/serialize-clinical";
import { updateNoteSchema } from "@/server/schemas/clinical";
import { updateNote, deleteNote, NoteNotFoundError, NoteAlreadySignedError } from "@/server/services/notes";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH is unsigned-only per docs/specs/api-surface.md — a signed note goes through
// POST /notes/:id/amend instead.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updateNoteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the note.", parsed.error.issues);
    }

    const note = await updateNote(actor, id, parsed.data);
    return NextResponse.json(serializeNote(note));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to write clinical notes.");
    if (err instanceof NoteNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof NoteAlreadySignedError) return errorResponse(422, "NOTE_ALREADY_SIGNED", err.message);
    throw err;
  }
}

// DELETE is unsigned-only, same rule as PATCH — a signed note can never be removed.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    await deleteNote(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to write clinical notes.");
    if (err instanceof NoteNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof NoteAlreadySignedError) return errorResponse(422, "NOTE_ALREADY_SIGNED", err.message);
    throw err;
  }
}
