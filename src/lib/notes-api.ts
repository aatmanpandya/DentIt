import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-clinical.ts.
export interface ClinicalNote {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  provider_id: string;
  body: string;
  signed_at: string | null;
  signed_by: string | null;
  amends_note_id: string | null;
  created_at: string;
  updated_at: string;
}

export function listPatientNotes(patientId: string) {
  return apiFetch<{ data: ClinicalNote[] }>(`/patients/${patientId}/notes`);
}

export interface CreateNoteInput {
  body: string;
  appointment_id?: string | null;
}

export function createNote(patientId: string, input: CreateNoteInput) {
  return apiFetch<ClinicalNote>(`/patients/${patientId}/notes`, { method: "POST", body: JSON.stringify(input) });
}

export function updateNote(id: string, body: string) {
  return apiFetch<ClinicalNote>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify({ body }) });
}

export function deleteNote(id: string) {
  return apiFetch<void>(`/notes/${id}`, { method: "DELETE" });
}

export function signNote(id: string) {
  return apiFetch<ClinicalNote>(`/notes/${id}/sign`, { method: "POST" });
}

export function amendNote(id: string, body: string) {
  return apiFetch<ClinicalNote>(`/notes/${id}/amend`, { method: "POST", body: JSON.stringify({ body }) });
}
