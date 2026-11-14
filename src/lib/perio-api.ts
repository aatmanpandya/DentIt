import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-perio.ts.
export type PerioSiteCode = "MB" | "B" | "DB" | "ML" | "L" | "DL";

export interface PerioSiteMeasurement {
  site: PerioSiteCode;
  pocket_depth: number | null;
  gingival_margin: number | null;
  cal: number | null;
  bleeding_on_probing: boolean;
  suppuration: boolean;
  plaque: boolean;
}

export interface PerioToothRecord {
  tooth: string;
  mobility: number | null;
  furcation: number | null;
  is_skipped: boolean;
  sites: PerioSiteMeasurement[];
}

export interface PerioExam {
  id: string;
  patient_id: string;
  provider_id: string;
  exam_date: string;
  notes: string | null;
  completed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PerioExamDetail extends PerioExam {
  teeth: PerioToothRecord[];
}

export function listPatientPerioExams(patientId: string) {
  return apiFetch<{ data: PerioExam[] }>(`/patients/${patientId}/perio-exams`);
}

export interface EligiblePerioProvider {
  id: string;
  full_name: string;
  role: string;
}

// Perio-scoped (Owner/Provider/Hygienist/Assistant), not schedule-api's listProviders() —
// that one excludes assistants (no provider_profiles row), see src/server/services/perio.ts.
export function listEligiblePerioProviders() {
  return apiFetch<{ data: EligiblePerioProvider[] }>(`/perio-exams/providers`);
}

export interface CreatePerioExamInput {
  exam_date: string;
  provider_id?: string | null;
  notes?: string | null;
}

export function createPerioExam(patientId: string, input: CreatePerioExamInput) {
  return apiFetch<PerioExam>(`/patients/${patientId}/perio-exams`, { method: "POST", body: JSON.stringify(input) });
}

export function getPerioExam(id: string) {
  return apiFetch<PerioExamDetail>(`/perio-exams/${id}`);
}

export function updatePerioExamNotes(id: string, notes: string | null) {
  return apiFetch<PerioExam>(`/perio-exams/${id}`, { method: "PATCH", body: JSON.stringify({ notes }) });
}

export interface PerioSiteInput {
  site: PerioSiteCode;
  pocket_depth: number;
  gingival_margin?: number | null;
  bleeding_on_probing?: boolean;
  suppuration?: boolean;
  plaque?: boolean;
}

export interface UpsertPerioToothRecordInput {
  mobility?: number | null;
  furcation?: number | null;
  is_skipped?: boolean;
  sites: PerioSiteInput[];
  clear_sites?: string[];
  source?: "keyboard" | "voice";
}

// The load-bearing call — fires once per tooth as the operator advances. The grid's own
// retry-queue (docs/specs/validation-and-errors.md) wraps this, not the caller.
export function upsertPerioToothRecord(examId: string, tooth: string, input: UpsertPerioToothRecordInput) {
  return apiFetch<PerioToothRecord>(`/perio-exams/${examId}/teeth/${tooth}`, { method: "PUT", body: JSON.stringify(input) });
}

export function completePerioExam(id: string) {
  return apiFetch<PerioExam>(`/perio-exams/${id}/complete`, { method: "POST" });
}

export function uncompletePerioExam(id: string, reason: string) {
  return apiFetch<PerioExam>(`/perio-exams/${id}/uncomplete`, { method: "POST", body: JSON.stringify({ reason }) });
}

// The exam's transcript — docs/specs/perio-approval.md.
export interface PerioChange {
  tooth: string;
  site: string | null;
  field: "pocket_depth" | "recession" | "bleeding" | "suppuration" | "plaque" | "mobility" | "furcation" | "skipped";
  from: number | boolean | null;
  to: number | boolean | null;
}

export interface PerioExamEvent {
  id: string;
  kind: "phrase" | "typed" | "approved" | "reopened";
  at: string;
  by: string | null;
  heard: string[] | null;
  used: string | null;
  outcome: "written" | "refused" | "waiting" | "undo" | null;
  note: string | null;
  changes: PerioChange[];
}

export function listPerioExamEvents(id: string) {
  return apiFetch<{ data: PerioExamEvent[] }>(`/perio-exams/${id}/events`);
}

export function recordPerioPhrase(id: string, phrase: Pick<PerioExamEvent, "heard" | "used" | "outcome" | "note" | "changes">) {
  return apiFetch<PerioExamEvent>(`/perio-exams/${id}/events`, { method: "POST", body: JSON.stringify(phrase) });
}

export interface PerioSiteDelta {
  tooth: string;
  site: PerioSiteCode;
  cal_now: number | null;
  cal_before: number | null;
  delta: number | null;
  significant: boolean;
}

export interface PerioCompareResult {
  against_exam_id: string | null;
  deltas: PerioSiteDelta[];
}

export function comparePerioExam(id: string, against?: string) {
  const query = against ? `?against=${against}` : "";
  return apiFetch<PerioCompareResult>(`/perio-exams/${id}/compare${query}`);
}
