import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { serializeInvoice, serializeInvoiceLine } from "@/server/lib/serialize-ledger";
import { createInvoiceSchema } from "@/server/schemas/ledger";
import { createInvoice } from "@/server/services/ledger";

/** Invoice completed procedures. No PATCH or DELETE exists: a wrong invoice is voided and reissued. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const parsed = createInvoiceSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(422, "VALIDATION_FAILED", "Check the invoice details.", parsed.error.issues);
    const { invoice, lines } = await createInvoice(actor, parsed.data);
    return NextResponse.json({ ...serializeInvoice(invoice), lines: lines.map(serializeInvoiceLine) }, { status: 201 });
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
