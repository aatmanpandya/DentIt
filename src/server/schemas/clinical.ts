import { z } from "zod";

const surfaceEnum = z.enum(["M", "D", "B", "L", "O", "I"]);

export const createConditionSchema = z.object({
  tooth: z.string().min(1),
  surfaces: z.array(surfaceEnum).nonempty().optional(),
  condition_type: z.string().min(1),
  note: z.string().nullable().optional(),
});

export const updateConditionSchema = z.object({
  resolve: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

export const createProcedureSchema = z.object({
  procedure_code_id: z.string().uuid(),
  tooth: z.string().min(1).nullable().optional(),
  surfaces: z.array(surfaceEnum).nonempty().nullable().optional(),
  quadrant: z.string().min(1).nullable().optional(),
  arch: z.enum(["upper", "lower"]).nullable().optional(),
  provider_id: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const chartedProcedureStatusEnum = z.enum([
  "planned",
  "accepted",
  "scheduled",
  "completed",
  "invoiced",
  "cancelled",
]);

export const updateProcedureStatusSchema = z.object({
  to_status: chartedProcedureStatusEnum,
});

// The amend-after-invoiced path (ADR-0002) — content fields only, never status.
export const updateProcedureContentSchema = z.object({
  tooth: z.string().min(1).nullable().optional(),
  surfaces: z.array(surfaceEnum).nonempty().nullable().optional(),
  quadrant: z.string().min(1).nullable().optional(),
  arch: z.enum(["upper", "lower"]).nullable().optional(),
  provider_id: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
});
