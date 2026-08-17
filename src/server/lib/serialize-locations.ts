import type { locations, operatories, providerSchedules } from "@/server/db/schema";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md.
export function serializeLocation(location: typeof locations.$inferSelect) {
  return {
    id: location.id,
    name: location.name,
    address_line1: location.addressLine1,
    address_line2: location.addressLine2,
    city: location.city,
    state: location.state,
    postal_code: location.postalCode,
    phone: location.phone,
    is_active: location.isActive,
  };
}

export function serializeOperatory(operatory: typeof operatories.$inferSelect) {
  return {
    id: operatory.id,
    location_id: operatory.locationId,
    name: operatory.name,
    display_order: operatory.displayOrder,
    is_active: operatory.isActive,
  };
}

export interface ProviderRow {
  id: string;
  fullName: string;
  role: string;
  color: string;
  defaultOperatoryId: string | null;
  qualification: string | null;
}

export function serializeProvider(provider: ProviderRow) {
  return {
    id: provider.id,
    full_name: provider.fullName,
    role: provider.role,
    color: provider.color,
    default_operatory_id: provider.defaultOperatoryId,
    qualification: provider.qualification,
  };
}

export function serializeProviderSchedule(schedule: typeof providerSchedules.$inferSelect) {
  return {
    id: schedule.id,
    provider_id: schedule.providerId,
    location_id: schedule.locationId,
    day_of_week: schedule.dayOfWeek,
    start_time: schedule.startTime,
    end_time: schedule.endTime,
    effective_from: schedule.effectiveFrom,
    effective_to: schedule.effectiveTo,
  };
}
