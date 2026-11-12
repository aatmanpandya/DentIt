import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse, notFoundUnlessUuid } from "@/server/lib/ledger-route-errors";
import { serializeInvoice } from "@/server/lib/serialize-ledger";
import { voidInvoiceSchema } from "@/server/schemas/ledger";
import { voidInvoice } from "@/server/services/ledger";

type RouteContext = { params: Promise<{ id: string }> };

/** Void with a reason. Procedures go back to completed; money paid on it becomes credit. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const badId = notFoundUnlessUuid(id);
    if (badId) return badId;
    const parsed = voidInvoiceSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Give a reason for voiding.", parsed.error.issues);
    return NextResponse.json(serializeInvoice(await voidInvoice(actor, id, parsed.data.reason)));
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
