import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-clinical.ts.
export type Surface = "M" | "D" | "B" | "L" | "O" | "I";

export interface Condition {
  id: string;
  patient_id: string;
  tooth: string | null;
  surfaces: Surface[] | null;
  condition_type: string;
  note: string | null;
  charted_by: string;
  charted_at: string;
  resolved_at: string | null;
}

export type ProcedureStatus = "planned" | "accepted" | "scheduled" | "completed" | "invoiced" | "cancelled";

export interface Procedure {
  id: string;
  patient_id: string;
  procedure_code_id: string;
  tooth: string | null;
  surfaces: Surface[] | null;
  quadrant: string | null;
  arch: "upper" | "lower" | null;
  status: ProcedureStatus;
  provider_id: string | null;
  appointment_id: string | null;
  price: string | null;
  fee_schedule_id: string | null;
  note: string | null;
  completed_at: string | null;
  invoiced_at: string | null;
  superseded_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientChart {
  conditions: Condition[];
  procedures: Procedure[];
}

export function getPatientChart(patientId: string) {
  return apiFetch<PatientChart>(`/patients/${patientId}/chart`);
}

export interface CreateConditionInput {
  tooth?: string | null;
  surfaces?: Surface[] | null;
  condition_type: string;
  note?: string | null;
}

export function createCondition(patientId: string, input: CreateConditionInput) {
  return apiFetch<Condition>(`/patients/${patientId}/conditions`, { method: "POST", body: JSON.stringify(input) });
}

export function updateCondition(id: string, input: { resolve?: boolean; note?: string | null }) {
  return apiFetch<Condition>(`/conditions/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export interface CreateProcedureInput {
  procedure_code_id: string;
  tooth?: string | null;
  surfaces?: Surface[] | null;
  quadrant?: string | null;
  arch?: "upper" | "lower" | null;
  provider_id?: string | null;
  note?: string | null;
}

export function createProcedure(patientId: string, input: CreateProcedureInput) {
  return apiFetch<Procedure>(`/patients/${patientId}/procedures`, { method: "POST", body: JSON.stringify(input) });
}

export function updateProcedureStatus(id: string, toStatus: ProcedureStatus) {
  return apiFetch<Procedure>(`/procedures/${id}`, { method: "PATCH", body: JSON.stringify({ to_status: toStatus }) });
}

export interface UpdateProcedureContentInput {
  tooth?: string | null;
  surfaces?: Surface[] | null;
  quadrant?: string | null;
  arch?: "upper" | "lower" | null;
  provider_id?: string | null;
  note?: string | null;
}

export function updateProcedureContent(id: string, input: UpdateProcedureContentInput) {
  return apiFetch<Procedure>(`/procedures/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function completeProcedure(id: string) {
  return apiFetch<Procedure>(`/procedures/${id}/complete`, { method: "POST" });
}

export function deleteProcedure(id: string) {
  return apiFetch<void>(`/procedures/${id}`, { method: "DELETE" });
}
