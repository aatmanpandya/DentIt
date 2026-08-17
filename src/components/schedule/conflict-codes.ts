/**
 * Error codes the day/week view and the create/edit panel treat as "warn with an
 * override", not a hard failure — see docs/specs/validation-and-errors.md.
 * APPOINTMENT_CONFLICT (the DB-enforced operatory double-book) is deliberately not in
 * this set: it has no override.
 */
export const OVERRIDABLE_CODES = new Set([
  "APPOINTMENT_OUTSIDE_HOURS",
  "APPOINTMENT_BLOCKED_PERIOD",
  "APPOINTMENT_PROVIDER_CONFLICT",
]);
