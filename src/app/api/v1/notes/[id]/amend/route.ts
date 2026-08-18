import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeNote } from "@/server/lib/serialize-clinical";
import { amendNoteSchema } from "@/server/schemas/clinical";
import { amendNote, NoteNotFoundError } from "@/server/services/notes";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = amendNoteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the amendment.", parsed.error.issues);
    }

    const amendment = await amendNote(actor, id, parsed.data);
    return NextResponse.json(serializeNote(amendment), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to write clinical notes.");
    if (err instanceof NoteNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    throw err;
  }
}
