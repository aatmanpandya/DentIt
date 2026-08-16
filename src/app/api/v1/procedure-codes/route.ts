import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeProcedureCode } from "@/server/lib/serialize-catalog";
import { createProcedureCodeSchema, listProcedureCodesQuerySchema } from "@/server/schemas/catalog";
import { listProcedureCodes, createProcedureCode, DuplicateProcedureCodeError } from "@/server/services/catalog";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = listProcedureCodesQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await listProcedureCodes(actor, {
      category: parsed.data.category,
      q: parsed.data.q,
      active: parsed.data.active,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });

    return NextResponse.json({
      data: result.data.map(serializeProcedureCode),
      next_cursor: result.nextCursor,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view the catalog.");
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = createProcedureCodeSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the procedure code details.", parsed.error.issues);
    }

    const code = await createProcedureCode(actor, parsed.data);
    return NextResponse.json(serializeProcedureCode(code), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit the catalog.");
    if (err instanceof DuplicateProcedureCodeError) return errorResponse(409, "DUPLICATE_PROCEDURE_CODE", err.message);
    throw err;
  }
}
