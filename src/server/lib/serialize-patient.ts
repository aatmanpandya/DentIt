import type { patients, patientAlerts } from "@/server/db/schema";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md. Shared
// across the patients routes so create/get/update/list all serialise identically.
export function serializePatient(patient: typeof patients.$inferSelect) {
  return {
    id: patient.id,
    patient_number: patient.patientNumber,
    first_name: patient.firstName,
    last_name: patient.lastName,
    date_of_birth: patient.dateOfBirth,
    sex: patient.sex,
    phone: patient.phone,
    email: patient.email,
    address_line1: patient.addressLine1,
    address_line2: patient.addressLine2,
    city: patient.city,
    state: patient.state,
    postal_code: patient.postalCode,
    preferred_location_id: patient.preferredLocationId,
    responsible_party_id: patient.responsiblePartyId,
    notes: patient.notes,
    is_active: patient.isActive,
    created_at: patient.createdAt.toISOString(),
    updated_at: patient.updatedAt.toISOString(),
  };
}

export function serializePatientAlert(alert: typeof patientAlerts.$inferSelect) {
  return {
    id: alert.id,
    patient_id: alert.patientId,
    alert_type: alert.alertType,
    label: alert.label,
    detail: alert.detail,
    severity: alert.severity,
    is_active: alert.isActive,
    created_at: alert.createdAt.toISOString(),
    updated_at: alert.updatedAt.toISOString(),
  };
}
