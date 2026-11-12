import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { ledgerErrorResponse, notFoundUnlessUuid } from "@/server/lib/ledger-route-errors";
import { serializePatientLedger } from "@/server/lib/serialize-ledger";
import { getPatientLedger } from "@/server/services/ledger";

type RouteContext = { params: Promise<{ id: string }> };

/** Patient Ledger tab — date-ordered entries with a running balance, invoices, credit. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const badId = notFoundUnlessUuid(id);
    if (badId) return badId;
    return NextResponse.json(serializePatientLedger(await getPatientLedger(actor, id)));
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
