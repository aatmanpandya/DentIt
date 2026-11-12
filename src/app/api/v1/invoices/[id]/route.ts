import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeInvoiceDetail } from "@/server/lib/serialize-ledger";
import { getInvoice } from "@/server/services/ledger";

type RouteContext = { params: Promise<{ id: string }> };

/** Everything the printable invoice page needs in one call. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    return NextResponse.json(serializeInvoiceDetail(await getInvoice(actor, id)));
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
