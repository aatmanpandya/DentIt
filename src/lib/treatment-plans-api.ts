import { apiFetch } from "./api-client";
import type { Surface, ProcedureStatus } from "./chart-api";

// Wire types — snake_case, mirroring src/server/lib/serialize-treatment-plans.ts.
export type TreatmentPlanStatus = "draft" | "presented" | "accepted" | "declined" | "completed";

export interface TreatmentPlan {
  id: string;
  patient_id: string;
  name: string;
  status: TreatmentPlanStatus;
  presented_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TreatmentPlanPhase {
  id: string;
  treatment_plan_id: string;
  name: string;
  sequence: number;
  note: string | null;
}

export interface TreatmentPlanItem {
  id: string;
  treatment_plan_phase_id: string;
  charted_procedure_id: string | null;
  sequence: number;
}

export interface TreatmentPlanItemDetail extends TreatmentPlanItem {
  procedure_code_id: string;
  procedure_short_name: string;
  tooth: string | null;
  surfaces: Surface[] | null;
  // null exactly when nothing's charted yet (a deferred item) — see
  // docs/specs/treatment-planning.md's "Adding a treatment without charting first".
  procedure_status: ProcedureStatus | null;
  price: string | null;
}

export interface TreatmentPlanPhaseDetail extends TreatmentPlanPhase {
  items: TreatmentPlanItemDetail[];
  subtotal: string | null;
}

export interface TreatmentPlanDetail extends TreatmentPlan {
  phases: TreatmentPlanPhaseDetail[];
  total: string | null;
}

export function listPatientTreatmentPlans(patientId: string) {
  return apiFetch<{ data: TreatmentPlan[] }>(`/patients/${patientId}/treatment-plans`);
}

export function getTreatmentPlan(id: string) {
  return apiFetch<TreatmentPlanDetail>(`/treatment-plans/${id}`);
}

export function createTreatmentPlan(patientId: string, name: string) {
  return apiFetch<TreatmentPlanDetail>(`/patients/${patientId}/treatment-plans`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renameTreatmentPlan(id: string, name: string) {
  return apiFetch<TreatmentPlan>(`/treatment-plans/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function declineTreatmentPlan(id: string) {
  return apiFetch<TreatmentPlan>(`/treatment-plans/${id}`, { method: "PATCH", body: JSON.stringify({ to_status: "declined" }) });
}

export function presentTreatmentPlan(id: string) {
  return apiFetch<TreatmentPlan>(`/treatment-plans/${id}/present`, { method: "POST" });
}

export function acceptTreatmentPlan(id: string, signatureImage?: string | null) {
  return apiFetch<TreatmentPlan>(`/treatment-plans/${id}/accept`, {
    method: "POST",
    body: JSON.stringify({ signature_image: signatureImage ?? null }),
  });
}

export function createPhase(planId: string, name: string) {
  return apiFetch<TreatmentPlanPhase>(`/treatment-plans/${planId}/phases`, { method: "POST", body: JSON.stringify({ name }) });
}

export function reorderPhase(phaseId: string, sequence: number) {
  return apiFetch<TreatmentPlanPhase>(`/phases/${phaseId}`, { method: "PATCH", body: JSON.stringify({ sequence }) });
}

export interface NewProcedureItemInput {
  procedure_code_id: string;
  tooth?: string | null;
  surfaces?: Surface[] | null;
  quadrant?: string | null;
  arch?: "upper" | "lower" | null;
  // true: chart it now (a real charted_procedure is created immediately). false:
  // defer until the plan is accepted. See docs/specs/treatment-planning.md's
  // "Adding a treatment without charting first".
  chart_now: boolean;
}

export function addExistingProcedureToPhase(phaseId: string, chartedProcedureId: string) {
  return apiFetch<TreatmentPlanItem>(`/phases/${phaseId}/items`, {
    method: "POST",
    body: JSON.stringify({ charted_procedure_id: chartedProcedureId }),
  });
}

export function addNewProcedureToPhase(phaseId: string, input: NewProcedureItemInput) {
  return apiFetch<TreatmentPlanItem>(`/phases/${phaseId}/items`, {
    method: "POST",
    body: JSON.stringify({ new_procedure: input }),
  });
}

export function removeItem(itemId: string) {
  return apiFetch<void>(`/items/${itemId}`, { method: "DELETE" });
}

export function reorderItem(itemId: string, sequence: number) {
  return apiFetch<TreatmentPlanItem>(`/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ sequence }) });
}
