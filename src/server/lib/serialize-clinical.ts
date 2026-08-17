import type { chartedConditions, chartedProcedures } from "@/server/db/schema";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md.
export function serializeCondition(condition: typeof chartedConditions.$inferSelect) {
  return {
    id: condition.id,
    patient_id: condition.patientId,
    tooth: condition.tooth,
    surfaces: condition.surfaces,
    condition_type: condition.conditionType,
    note: condition.note,
    charted_by: condition.chartedBy,
    charted_at: condition.chartedAt.toISOString(),
    resolved_at: condition.resolvedAt ? condition.resolvedAt.toISOString() : null,
  };
}

// `price` is kept as a decimal string per CLAUDE.md's money rule even though it's always
// null at charting time (docs/specs/odontogram.md — price entry is deferred to invoicing).
export function serializeProcedure(procedure: typeof chartedProcedures.$inferSelect) {
  return {
    id: procedure.id,
    patient_id: procedure.patientId,
    procedure_code_id: procedure.procedureCodeId,
    tooth: procedure.tooth,
    surfaces: procedure.surfaces,
    quadrant: procedure.quadrant,
    arch: procedure.arch,
    status: procedure.status,
    provider_id: procedure.providerId,
    appointment_id: procedure.appointmentId,
    price: procedure.price,
    fee_schedule_id: procedure.feeScheduleId,
    note: procedure.note,
    completed_at: procedure.completedAt ? procedure.completedAt.toISOString() : null,
    invoiced_at: procedure.invoicedAt ? procedure.invoicedAt.toISOString() : null,
    superseded_by_id: procedure.supersededById,
    created_at: procedure.createdAt.toISOString(),
    updated_at: procedure.updatedAt.toISOString(),
  };
}
