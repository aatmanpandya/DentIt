import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeOrganizationLedger } from "@/server/lib/serialize-ledger";
import { getOrganizationLedger } from "@/server/services/ledger";

/** Org-wide /ledger page: recent invoices and patients with a balance. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    return NextResponse.json(serializeOrganizationLedger(await getOrganizationLedger(actor)));
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
