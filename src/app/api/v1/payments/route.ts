import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeAllocation, serializePayment } from "@/server/lib/serialize-ledger";
import { recordPaymentSchema } from "@/server/schemas/ledger";
import { recordPayment } from "@/server/services/ledger";

/**
 * Record money received. Honours the Idempotency-Key header: a retry with the same key and
 * body returns the original payment (200) instead of recording the money twice.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const parsed = recordPaymentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Check the payment details.", parsed.error.issues);
    const key = req.headers.get("idempotency-key")?.trim() || null;
    const result = await recordPayment(actor, parsed.data, key);
    return NextResponse.json(
      { ...serializePayment(result.payment), allocations: result.allocations.map(serializeAllocation) },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
