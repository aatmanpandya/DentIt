import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeAdjustment } from "@/server/lib/serialize-ledger";
import { createAdjustmentSchema } from "@/server/schemas/ledger";
import { createAdjustment } from "@/server/services/ledger";

/** Discount, write-off or correction on an invoice. Signed amount; reason required. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const parsed = createAdjustmentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Check the adjustment.", parsed.error.issues);
    return NextResponse.json(serializeAdjustment(await createAdjustment(actor, parsed.data)), { status: 201 });
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
