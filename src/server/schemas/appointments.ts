import { z } from "zod";

export const appointmentStatusEnum = z.enum([
  "scheduled",
  "confirmed",
  "arrived",
  "seated",
  "completed",
  "cancelled",
  "no_show",
]);

export const cancelledByEnum = z.enum(["patient", "practice"]);

function afterStart(data: { starts_at: string; ends_at: string }) {
  return new Date(data.ends_at) > new Date(data.starts_at);
}

export const createAppointmentSchema = z
  .object({
    patient_id: z.string().uuid(),
    location_id: z.string().uuid(),
    operatory_id: z.string().uuid(),
    provider_id: z.string().uuid(),
    appointment_type_id: z.string().uuid().nullable().optional(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    note: z.string().nullable().optional(),
    // Acknowledges APPOINTMENT_OUTSIDE_HOURS / APPOINTMENT_BLOCKED_PERIOD /
    // APPOINTMENT_PROVIDER_CONFLICT — "book anyway". Never overrides
    // APPOINTMENT_CONFLICT (the DB-enforced operatory double-book), which has no override.
    override: z.boolean().optional(),
  })
  .refine(afterStart, { message: "End time must be after start time.", path: ["ends_at"] });

export const updateAppointmentSchema = z
  .object({
    operatory_id: z.string().uuid().optional(),
    provider_id: z.string().uuid().optional(),
    starts_at: z.string().datetime({ offset: true }).optional(),
    ends_at: z.string().datetime({ offset: true }).optional(),
    note: z.string().nullable().optional(),
    override: z.boolean().optional(),
  })
  .refine((data) => (data.starts_at && data.ends_at ? afterStart({ starts_at: data.starts_at, ends_at: data.ends_at }) : true), {
    message: "End time must be after start time.",
    path: ["ends_at"],
  });

export const listAppointmentsQuerySchema = z
  .object({
    location_id: z.string().uuid(),
    date: z.string().date().optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    provider_id: z.string().uuid().optional(),
    operatory_id: z.string().uuid().optional(),
  })
  .refine((data) => data.date !== undefined || (data.from !== undefined && data.to !== undefined), {
    message: "Provide either date, or both from and to.",
  });

export const transitionAppointmentSchema = z
  .object({
    to_status: appointmentStatusEnum,
    reason: z.string().min(1).optional(),
    cancelled_by: cancelledByEnum.optional(),
  })
  .refine((data) => data.to_status !== "cancelled" || (data.reason && data.cancelled_by), {
    message: "Cancelling requires a reason and who cancelled it.",
    path: ["reason"],
  });

export const rescheduleAppointmentSchema = z
  .object({
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    operatory_id: z.string().uuid(),
    provider_id: z.string().uuid().optional(),
    override: z.boolean().optional(),
  })
  .refine(afterStart, { message: "End time must be after start time.", path: ["ends_at"] });

export const listScheduleBlocksQuerySchema = z.object({
  location_id: z.string().uuid().optional(),
  from: z.string().date(),
  to: z.string().date(),
});

export const listProviderScheduleQuerySchema = z.object({
  location_id: z.string().uuid().optional(),
});

export const getAvailabilityQuerySchema = z.object({
  location_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  date: z.string().date(),
  duration: z.coerce.number().int().positive(),
});
