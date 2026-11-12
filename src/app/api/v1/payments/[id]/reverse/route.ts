import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse, notFoundUnlessUuid } from "@/server/lib/ledger-route-errors";
import { reversePaymentSchema } from "@/server/schemas/ledger";
import { reversePayment } from "@/server/services/ledger";

type RouteContext = { params: Promise<{ id: string }> };

/** Take back a payment recorded by mistake. Append-only: the payment stays on record. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const badId = notFoundUnlessUuid(id);
    if (badId) return badId;
    const parsed = reversePaymentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Give a reason for reversing this payment.", parsed.error.issues);
    const reversal = await reversePayment(actor, id, parsed.data.reason);
    return NextResponse.json({ id: reversal.id, payment_id: reversal.paymentId, reason: reversal.reason, reversed_at: reversal.reversedAt.toISOString() }, { status: 201 });
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
