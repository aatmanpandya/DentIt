import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { dbForRequest } from "@/server/db/tenant";
import { users, organizations, userLocationAccess } from "@/server/db/schema";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    return await dbForRequest(actor.organizationId, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, actor.userId)).limit(1);
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.organizationId)).limit(1);
      const locationAccess = await tx
        .select({ locationId: userLocationAccess.locationId })
        .from(userLocationAccess)
        .where(eq(userLocationAccess.userId, actor.userId));

      if (!user || !org) return errorResponse(401, "AUTH_TOKEN_EXPIRED", "Please sign in again.");

      return NextResponse.json({
        id: user.id,
        full_name: user.fullName,
        email: user.email,
        role: user.role,
        organization: {
          id: org.id,
          name: org.name,
          tooth_notation_display: org.toothNotationDisplay,
          timezone: org.timezone,
          probing_sequence: org.probingSequence,
        },
        // Empty array = access to all locations, per pilot-foundations.md §4.
        location_ids: locationAccess.map((l) => l.locationId),
      });
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    throw err;
  }
}
