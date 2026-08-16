import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeFeeScheduleItem } from "@/server/lib/serialize-catalog";
import { upsertFeeScheduleItemsSchema } from "@/server/schemas/catalog";
import { listFeeScheduleItems, upsertFeeScheduleItems, FeeScheduleNotFoundError } from "@/server/services/catalog";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const items = await listFeeScheduleItems(actor, id);
    return NextResponse.json({ data: items.map(serializeFeeScheduleItem) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view fee schedules.");
    if (err instanceof FeeScheduleNotFoundError) return errorResponse(404, "NOT_FOUND", "Fee schedule not found.");
    throw err;
  }
}

// Bulk upsert — the editor saves the whole grid in one atomic request rather than one
// PATCH per row. See docs/specs/api-surface.md.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;

    const parsed = upsertFeeScheduleItemsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the fee schedule items.", parsed.error.issues);
    }

    const items = await upsertFeeScheduleItems(actor, id, parsed.data.items);
    return NextResponse.json({ data: items.map(serializeFeeScheduleItem) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to edit fee schedules.");
    if (err instanceof FeeScheduleNotFoundError) return errorResponse(404, "NOT_FOUND", "Fee schedule not found.");
    throw err;
  }
}
