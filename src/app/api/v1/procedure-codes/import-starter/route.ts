import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeProcedureCode } from "@/server/lib/serialize-catalog";
import { importStarterTemplate } from "@/server/services/catalog";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const imported = await importStarterTemplate(actor);
    return NextResponse.json({ data: imported.map(serializeProcedureCode) }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit the catalog.");
    throw err;
  }
}
