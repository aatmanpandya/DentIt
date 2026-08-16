import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { pricingQuerySchema } from "@/server/schemas/catalog";
import { getPricing, FeeScheduleNoPriceError } from "@/server/services/catalog";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = pricingQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await getPricing(actor, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view pricing.");
    if (err instanceof FeeScheduleNoPriceError) return errorResponse(422, "FEE_SCHEDULE_NO_PRICE", err.message);
    throw err;
  }
}
