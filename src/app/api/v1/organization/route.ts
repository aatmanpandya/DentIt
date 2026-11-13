import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { updateProbingSequence, InvalidProbingSequenceError } from "@/server/services/organizations";

// Owner-only, scoped to a single field for now — docs/specs/perio.md's per-organization
// traversal-order decision. Not a general org-settings endpoint; grow it deliberately if a
// real second field ever needs one.
const updateOrganizationSchema = z.object({
  probing_sequence: z.array(z.string()).nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = updateOrganizationSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the organization settings.", parsed.error.issues);
    }

    const org = await updateProbingSequence(actor, parsed.data);
    return NextResponse.json({ id: org.id, probing_sequence: org.probingSequence });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to change organization settings.");
    if (err instanceof InvalidProbingSequenceError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    throw err;
  }
}
