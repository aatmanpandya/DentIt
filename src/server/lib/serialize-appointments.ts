import type { appointments, appointmentTypes, scheduleBlocks } from "@/server/db/schema";

// snake_case in JSON, matching the database — see docs/specs/api-surface.md.
// `patientFirstName`/`patientLastName` are present only on rows from listAppointments'
// joined query (the day view's primary read) — optional so this same function still
// serializes plain appointments.$inferSelect rows from create/update/transition/reschedule.
export function serializeAppointment(
  appt: typeof appointments.$inferSelect & { patientFirstName?: string; patientLastName?: string },
) {
  return {
    id: appt.id,
    location_id: appt.locationId,
    operatory_id: appt.operatoryId,
    patient_id: appt.patientId,
    provider_id: appt.providerId,
    appointment_type_id: appt.appointmentTypeId,
    starts_at: appt.startsAt.toISOString(),
    ends_at: appt.endsAt.toISOString(),
    status: appt.status,
    note: appt.note,
    confirmed_at: appt.confirmedAt ? appt.confirmedAt.toISOString() : null,
    arrived_at: appt.arrivedAt ? appt.arrivedAt.toISOString() : null,
    seated_at: appt.seatedAt ? appt.seatedAt.toISOString() : null,
    completed_at: appt.completedAt ? appt.completedAt.toISOString() : null,
    cancelled_at: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    cancelled_by: appt.cancelledBy,
    cancellation_reason: appt.cancellationReason,
    rescheduled_to_id: appt.rescheduledToId,
    created_at: appt.createdAt.toISOString(),
    updated_at: appt.updatedAt.toISOString(),
    ...(appt.patientFirstName !== undefined
      ? { patient_first_name: appt.patientFirstName, patient_last_name: appt.patientLastName }
      : {}),
  };
}

export function serializeAppointmentType(type: typeof appointmentTypes.$inferSelect) {
  return {
    id: type.id,
    name: type.name,
    default_duration_minutes: type.defaultDurationMinutes,
    color: type.color,
    is_active: type.isActive,
  };
}

export function serializeScheduleBlock(block: typeof scheduleBlocks.$inferSelect) {
  return {
    id: block.id,
    location_id: block.locationId,
    provider_id: block.providerId,
    operatory_id: block.operatoryId,
    starts_at: block.startsAt.toISOString(),
    ends_at: block.endsAt.toISOString(),
    reason: block.reason,
  };
}
