import type { treatmentPlans, treatmentPlanPhases, treatmentPlanItems } from "@/server/db/schema";
import type { TreatmentPlanDetail, TreatmentPlanPhaseDetail } from "@/server/services/treatment-plans";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md.
export function serializeTreatmentPlan(plan: typeof treatmentPlans.$inferSelect) {
  return {
    id: plan.id,
    patient_id: plan.patientId,
    name: plan.name,
    status: plan.status,
    presented_at: plan.presentedAt ? plan.presentedAt.toISOString() : null,
    accepted_at: plan.acceptedAt ? plan.acceptedAt.toISOString() : null,
    created_at: plan.createdAt.toISOString(),
    updated_at: plan.updatedAt.toISOString(),
  };
}

export function serializeTreatmentPlanPhase(phase: typeof treatmentPlanPhases.$inferSelect) {
  return { id: phase.id, treatment_plan_id: phase.treatmentPlanId, name: phase.name, sequence: phase.sequence, note: phase.note };
}

export function serializeTreatmentPlanItem(item: typeof treatmentPlanItems.$inferSelect) {
  return {
    id: item.id,
    treatment_plan_phase_id: item.treatmentPlanPhaseId,
    charted_procedure_id: item.chartedProcedureId,
    sequence: item.sequence,
  };
}

/**
 * Sums decimal-string money values as integer paise/cents to avoid float error —
 * money is always a decimal string over the wire per CLAUDE.md. Returns null (never
 * a partial figure) if any input is null — an unpriced item makes the total
 * meaningless, not merely smaller. See docs/specs/treatment-planning.md.
 */
function sumMoney(values: (string | null)[]): string | null {
  if (values.some((v) => v === null)) return null;
  const totalCents = values.reduce((sum, v) => sum + Math.round(Number(v) * 100), 0);
  return (totalCents / 100).toFixed(2);
}

function serializePhaseDetail(detail: TreatmentPlanPhaseDetail) {
  const items = detail.items.map(({ item, procedureCode, tooth, surfaces, procedureStatus, price }) => ({
    ...serializeTreatmentPlanItem(item),
    procedure_code_id: procedureCode.id,
    procedure_short_name: procedureCode.shortName,
    tooth,
    surfaces,
    // null exactly when nothing's charted yet (a deferred item) — see
    // docs/specs/treatment-planning.md's "Adding a treatment without charting first".
    procedure_status: procedureStatus,
    price,
  }));

  return {
    ...serializeTreatmentPlanPhase(detail.phase),
    items,
    subtotal: sumMoney(items.map((i) => i.price)),
  };
}

/** GET /treatment-plans/:id — the full builder/presentation payload. */
export function serializeTreatmentPlanDetail(detail: TreatmentPlanDetail) {
  const phases = detail.phases.map(serializePhaseDetail);
  const allPrices = detail.phases.flatMap((p) => p.items.map((i) => i.price));

  return {
    ...serializeTreatmentPlan(detail.plan),
    phases,
    total: sumMoney(allPrices),
  };
}
