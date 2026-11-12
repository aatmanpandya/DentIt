import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { ledgerErrorResponse } from "@/server/lib/ledger-route-errors";
import { suggestLocationQuerySchema } from "@/server/schemas/ledger";
import { suggestInvoiceLocation } from "@/server/services/ledger";

/** Pre-fill for the location picker in Create invoice / Record payment. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const parsed = suggestLocationQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) return errorResponse(400, "VALIDATION_FAILED", "Check the parameters.", parsed.error.issues);
    const suggestion = await suggestInvoiceLocation(actor, parsed.data.patient_id, parsed.data.charted_procedure_ids);
    return NextResponse.json({ location_id: suggestion.locationId, mixed: suggestion.mixed });
  } catch (err) {
    const mapped = ledgerErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}
