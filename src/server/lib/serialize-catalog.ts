import type { procedureCodes, feeSchedules, feeScheduleItems } from "@/server/db/schema";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md.
export function serializeProcedureCode(code: typeof procedureCodes.$inferSelect) {
  return {
    id: code.id,
    code: code.code,
    short_name: code.shortName,
    description: code.description,
    category: code.category,
    applies_to: code.appliesTo,
    surfaces_required: code.surfacesRequired,
    tax_class: code.taxClass,
    cdt_equivalent: code.cdtEquivalent,
    is_active: code.isActive,
    created_at: code.createdAt.toISOString(),
    updated_at: code.updatedAt.toISOString(),
  };
}

export function serializeFeeSchedule(schedule: typeof feeSchedules.$inferSelect) {
  return {
    id: schedule.id,
    name: schedule.name,
    location_id: schedule.locationId,
    effective_from: schedule.effectiveFrom,
    effective_to: schedule.effectiveTo,
    is_default: schedule.isDefault,
    created_at: schedule.createdAt.toISOString(),
    updated_at: schedule.updatedAt.toISOString(),
  };
}

export function serializeFeeScheduleItem(item: typeof feeScheduleItems.$inferSelect) {
  return {
    id: item.id,
    fee_schedule_id: item.feeScheduleId,
    procedure_code_id: item.procedureCodeId,
    price: item.price,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}
