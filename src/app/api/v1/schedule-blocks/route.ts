import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { serializeScheduleBlock } from "@/server/lib/serialize-appointments";
import { listScheduleBlocksQuerySchema } from "@/server/schemas/appointments";
import { listScheduleBlocks } from "@/server/services/appointments";

// Read-only for the pilot — nothing in the day view creates a schedule_blocks row yet.
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = listScheduleBlocksQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await listScheduleBlocks(actor, parsed.data);
    return NextResponse.json({ data: result.map(serializeScheduleBlock) });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    throw err;
  }
}
