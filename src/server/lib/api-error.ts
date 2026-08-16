import { NextResponse } from "next/server";

/**
 * Shared error shape for every route — see docs/specs/validation-and-errors.md.
 * `code` is stable and switchable, `message` is shown to the user as-is in the
 * interface's voice, `details` drives inline field errors.
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}
