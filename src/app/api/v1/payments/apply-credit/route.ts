import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeAllocation } from "@/server/lib/serialize-ledger";
import { applyCreditSchema } from "@/server/schemas/ledger";
import { applyCredit } from "@/server/services/ledger";

/** Allocate a patient's existing unallocated credit to an invoice. No new money. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const parsed = applyCreditSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Check the amount.", parsed.error.issues);
    const allocations = await applyCredit(actor, parsed.data);
    return NextResponse.json({ data: allocations.map(serializeAllocation) }, { status: 201 });
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
