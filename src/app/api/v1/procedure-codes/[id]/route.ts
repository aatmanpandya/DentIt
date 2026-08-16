import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeProcedureCode } from "@/server/lib/serialize-catalog";
import { updateProcedureCodeSchema } from "@/server/schemas/catalog";
import { updateProcedureCode, ProcedureCodeNotFoundError, DuplicateProcedureCodeError } from "@/server/services/catalog";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = updateProcedureCodeSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the procedure code details.", parsed.error.issues);
    }

    const code = await updateProcedureCode(actor, id, parsed.data);
    return NextResponse.json(serializeProcedureCode(code));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit the catalog.");
    if (err instanceof ProcedureCodeNotFoundError) return errorResponse(404, "NOT_FOUND", "Procedure code not found.");
    if (err instanceof DuplicateProcedureCodeError) return errorResponse(409, "DUPLICATE_PROCEDURE_CODE", err.message);
    throw err;
  }
}
