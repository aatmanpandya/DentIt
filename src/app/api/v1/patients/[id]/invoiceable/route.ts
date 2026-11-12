import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeInvoiceable } from "@/server/lib/serialize-ledger";
import { listInvoiceableProcedures } from "@/server/services/ledger";

type RouteContext = { params: Promise<{ id: string }> };

/** Completed procedures not yet invoiced — the Create invoice panel's list, with price and its source. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const rows = await listInvoiceableProcedures(actor, id);
    return NextResponse.json({ data: rows.map(serializeInvoiceable) });
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
