import { NextResponse } from "next/server";
import { errorResponse } from "./api-error";
import { UnauthenticatedError, SessionExpiredError } from "./request-auth";
import { PermissionDeniedError } from "./permissions";
import { InvalidMoneyError } from "./money";
import {
  InvoiceNotFoundError,
  PatientNotFoundError,
  LocationNotFoundError,
  ProcedureNotInvoiceableError,
  ProcedureNotPricedError,
  InvoiceAlreadyVoidError,
  PaymentExceedsBalanceError,
  IdempotencyKeyReusedError,
  AdjustmentInvalidError,
  ChargeReductionNotAllowedError,
} from "@/server/services/ledger";

/**
 * One error→HTTP mapping for every ledger route (ten handlers share these error types).
 * Translation only — no business logic. Codes per docs/specs/validation-and-errors.md.
 */
export function ledgerErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof UnauthenticatedError) return errorResponse(401, "AUTH_TOKEN_EXPIRED", err.message);
  if (err instanceof SessionExpiredError) return errorResponse(401, "AUTH_SESSION_IDLE_TIMEOUT", err.message);
  if (err instanceof PermissionDeniedError) return errorResponse(403, "PERMISSION_DENIED", "You don't have permission to do that in the ledger.");
  if (err instanceof ChargeReductionNotAllowedError) return errorResponse(403, "PERMISSION_DENIED", err.message);
  if (err instanceof InvoiceNotFoundError || err instanceof PatientNotFoundError || err instanceof LocationNotFoundError) {
    return errorResponse(404, "NOT_FOUND", err.message);
  }
  if (err instanceof ProcedureNotInvoiceableError) return errorResponse(422, "PROCEDURE_NOT_INVOICEABLE", err.message);
  if (err instanceof ProcedureNotPricedError) return errorResponse(422, "PROCEDURE_NOT_PRICED", err.message);
  if (err instanceof InvoiceAlreadyVoidError) return errorResponse(422, "INVOICE_ALREADY_VOID", err.message);
  if (err instanceof PaymentExceedsBalanceError) return errorResponse(422, "PAYMENT_EXCEEDS_BALANCE", err.message);
  if (err instanceof IdempotencyKeyReusedError) return errorResponse(422, "IDEMPOTENCY_KEY_REUSED", err.message);
  if (err instanceof AdjustmentInvalidError) return errorResponse(422, "ADJUSTMENT_INVALID", err.message);
  if (err instanceof InvalidMoneyError) return errorResponse(422, "VALIDATION_FAILED", err.message);
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A malformed id in the URL is simply "not found" — without this check Postgres rejects the
 * uuid cast (22P02) and the route returns a 500 (docs/bug-log.md entry 17).
 */
export function notFoundUnlessUuid(id: string): NextResponse | null {
  return UUID.test(id) ? null : errorResponse(404, "NOT_FOUND", "Not found.");
}
