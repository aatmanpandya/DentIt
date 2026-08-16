import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializePatient } from "@/server/lib/serialize-patient";
import { createPatientSchema, listPatientsQuerySchema } from "@/server/schemas/patients";
import { createPatient, listPatients } from "@/server/services/patients";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = listPatientsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return errorResponse(400, "VALIDATION_FAILED", "Check the search parameters.", parsed.error.issues);
    }

    const result = await listPatients(actor, {
      q: parsed.data.q,
      location_id: parsed.data.location_id,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });

    return NextResponse.json({
      data: result.data.map(serializePatient),
      next_cursor: result.nextCursor,
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to view patients.");
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req);

    const parsed = createPatientSchema.safeParse(await req.json());
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the patient details.", parsed.error.issues);
    }

    const patient = await createPatient(actor, parsed.data);
    return NextResponse.json(serializePatient(patient), { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to add patients.");
    throw err;
  }
}
