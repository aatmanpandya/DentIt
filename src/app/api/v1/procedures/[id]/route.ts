import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthenticatedError, SessionExpiredError } from "@/server/lib/request-auth";
import { errorResponse } from "@/server/lib/api-error";
import { PermissionDeniedError } from "@/server/lib/permissions";
import { serializeProcedure } from "@/server/lib/serialize-clinical";
import { updateProcedureStatusSchema, updateProcedureContentSchema } from "@/server/schemas/clinical";
import {
  updateProcedureStatus,
  updateProcedureContent,
  deleteProcedure,
  ProcedureNotFoundError,
  ProcedureCodeNotFoundError,
  InvalidToothError,
  ProcedureScopeMismatchError,
  ProcedureInvalidSurfaceError,
  IllegalProcedureTransitionError,
  ProcedureOnOpenPlanError,
  ProcedureOnPlanError,
  ProcedureAlreadyInvoicedError,
  ProcedureNotDeletableError,
} from "@/server/services/chart";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH does double duty per docs/specs/api-surface.md's single `PATCH /procedures/:id` —
// a `to_status` body is a lifecycle transition, anything else is a content amendment
// (which itself may supersede-and-insert per ADR-0002 if the procedure is invoiced).
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (body && typeof body === "object" && "to_status" in body) {
      const parsed = updateProcedureStatusSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(422, "VALIDATION_FAILED", "Check the status change.", parsed.error.issues);
      }
      const procedure = await updateProcedureStatus(actor, id, parsed.data.to_status);
      return NextResponse.json(serializeProcedure(procedure));
    }

    const parsed = updateProcedureContentSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(422, "VALIDATION_FAILED", "Check the procedure details.", parsed.error.issues);
    }
    const procedure = await updateProcedureContent(actor, id, parsed.data);
    return NextResponse.json(serializeProcedure(procedure));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to chart.");
    if (err instanceof ProcedureNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof ProcedureCodeNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof InvalidToothError) return errorResponse(422, "VALIDATION_FAILED", err.message);
    if (err instanceof ProcedureScopeMismatchError) return errorResponse(422, "PROCEDURE_SCOPE_MISMATCH", err.message);
    if (err instanceof ProcedureInvalidSurfaceError) return errorResponse(422, "PROCEDURE_INVALID_SURFACE", err.message);
    if (err instanceof IllegalProcedureTransitionError) return errorResponse(422, "PROCEDURE_ILLEGAL_TRANSITION", err.message);
    if (err instanceof ProcedureOnOpenPlanError) return errorResponse(422, "PROCEDURE_ON_OPEN_PLAN", err.message);
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireAuth(req);
    const { id } = await params;
    await deleteProcedure(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
    if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
    if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to chart.");
    if (err instanceof ProcedureNotFoundError) return errorResponse(404, "NOT_FOUND", err.message);
    if (err instanceof ProcedureAlreadyInvoicedError) return errorResponse(409, "PROCEDURE_ALREADY_INVOICED", err.message);
    if (err instanceof ProcedureNotDeletableError) return errorResponse(422, "PROCEDURE_NOT_DELETABLE", err.message);
    if (err instanceof ProcedureOnPlanError) return errorResponse(422, "PROCEDURE_ON_PLAN", err.message);
    throw err;
  }
}
