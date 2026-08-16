/**
 * RBAC matrix, code form of docs/specs/pilot-foundations.md §4.
 * Checked in the service layer — the UI hides what it must, but hiding is not
 * enforcement. Every service method that mutates or reads sensitive data calls can().
 */

export type Role =
  | "owner"
  | "admin"
  | "front_desk"
  | "provider"
  | "hygienist"
  | "assistant"
  | "accountant";

export type Resource =
  | "patients"
  | "appointments"
  | "odontogram"
  | "perio"
  | "clinical_notes"
  | "clinical_notes.sign"
  | "treatment_plans"
  | "invoices_payments"
  | "fee_schedules"
  | "users"
  | "org_settings"
  | "audit_log";

export type Action = "read" | "write";

const MATRIX: Record<Resource, Partial<Record<Role, Action[]>>> = {
  patients: {
    owner: ["read", "write"], admin: ["read", "write"], front_desk: ["read", "write"],
    provider: ["read", "write"], hygienist: ["read", "write"], assistant: ["read", "write"],
    accountant: ["read"],
  },
  appointments: {
    owner: ["read", "write"], admin: ["read", "write"], front_desk: ["read", "write"],
    provider: ["read", "write"], hygienist: ["read", "write"], assistant: ["read", "write"],
    accountant: ["read"],
  },
  odontogram: {
    owner: ["read", "write"], admin: ["read"], front_desk: ["read"],
    provider: ["read", "write"], hygienist: ["read", "write"], assistant: ["read"],
  },
  // Assistants may write perio — they transcribe called-out readings, not independent
  // clinical judgement. Confirmed with the partner clinic. See pilot-foundations.md §4.
  perio: {
    owner: ["read", "write"], admin: ["read"],
    provider: ["read", "write"], hygienist: ["read", "write"], assistant: ["read", "write"],
  },
  clinical_notes: {
    owner: ["read", "write"], provider: ["read", "write"], hygienist: ["read", "write"],
  },
  "clinical_notes.sign": {
    owner: ["write"], provider: ["write"], hygienist: ["write"],
  },
  treatment_plans: {
    owner: ["read", "write"], admin: ["read", "write"], front_desk: ["read"],
    provider: ["read", "write"], hygienist: ["read", "write"], assistant: ["read"],
    accountant: ["read"],
  },
  invoices_payments: {
    owner: ["read", "write"], admin: ["read", "write"], front_desk: ["read", "write"],
    provider: ["read"], accountant: ["read", "write"],
  },
  fee_schedules: {
    owner: ["read", "write"], admin: ["read", "write"], accountant: ["read", "write"],
  },
  users: {
    owner: ["read", "write"], admin: ["read", "write"],
  },
  org_settings: {
    owner: ["read", "write"],
  },
  audit_log: {
    owner: ["read"], admin: ["read"],
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  return MATRIX[resource]?.[role]?.includes(action) ?? false;
}

export class PermissionDeniedError extends Error {
  constructor(role: Role, resource: Resource, action: Action) {
    super(`Role "${role}" cannot ${action} "${resource}"`);
    this.name = "PermissionDeniedError";
  }
}

export function assertCan(role: Role, resource: Resource, action: Action): void {
  if (!can(role, resource, action)) {
    throw new PermissionDeniedError(role, resource, action);
  }
}
