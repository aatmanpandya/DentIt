import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-patient.ts.
export interface Patient {
  id: string;
  patient_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  sex: "male" | "female" | "other" | null;
  phone: string;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  preferred_location_id: string | null;
  responsible_party_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientAlert {
  id: string;
  patient_id: string;
  alert_type: "allergy" | "medical" | "precaution";
  label: string;
  detail: string | null;
  severity: "info" | "warning" | "critical";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientSummary {
  alerts: PatientAlert[];
  next_appointment: { id: string; starts_at: string; status: string } | null;
  last_visit_at: string | null;
  balance: string;
}

export interface ResponsiblePartyInput {
  full_name: string;
  phone: string;
  email?: string | null;
  relationship: string;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export interface PatientInput {
  first_name: string;
  last_name: string;
  phone: string;
  date_of_birth?: string | null;
  sex?: "male" | "female" | "other" | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  preferred_location_id?: string | null;
  notes?: string | null;
  responsible_party?: ResponsiblePartyInput | null;
}

export function listPatients(params: { q?: string; location_id?: string; cursor?: string; limit?: number } = {}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.location_id) search.set("location_id", params.location_id);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch<{ data: Patient[]; next_cursor: string | null }>(`/patients${qs ? `?${qs}` : ""}`);
}

export function getPatient(id: string) {
  return apiFetch<Patient>(`/patients/${id}`);
}

export function createPatient(input: PatientInput) {
  return apiFetch<Patient>("/patients", { method: "POST", body: JSON.stringify(input) });
}

export function updatePatient(id: string, input: Partial<PatientInput> & { is_active?: boolean }) {
  return apiFetch<Patient>(`/patients/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deletePatient(id: string) {
  return apiFetch<void>(`/patients/${id}`, { method: "DELETE" });
}

export function getPatientSummary(id: string) {
  return apiFetch<PatientSummary>(`/patients/${id}/summary`);
}

export function listPatientAlerts(patientId: string) {
  return apiFetch<{ data: PatientAlert[] }>(`/patients/${patientId}/alerts`);
}

export function createPatientAlert(
  patientId: string,
  input: { alert_type: PatientAlert["alert_type"]; label: string; detail?: string | null; severity?: PatientAlert["severity"] },
) {
  return apiFetch<PatientAlert>(`/patients/${patientId}/alerts`, { method: "POST", body: JSON.stringify(input) });
}

export function updatePatientAlert(
  alertId: string,
  input: Partial<{ label: string; detail: string | null; severity: PatientAlert["severity"]; is_active: boolean }>,
) {
  return apiFetch<PatientAlert>(`/alerts/${alertId}`, { method: "PATCH", body: JSON.stringify(input) });
}
