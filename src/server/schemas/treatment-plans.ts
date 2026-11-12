import { z } from "zod";
import { surfaceEnum } from "./clinical";

export const createTreatmentPlanSchema = z.object({
  name: z.string().min(1),
});

export const updateTreatmentPlanSchema = z.object({
  name: z.string().min(1).optional(),
  // Only `declined` reaches this path — `present`/`accept` are dedicated endpoints.
  // See docs/specs/treatment-planning.md's "Plan lifecycle" section.
  to_status: z.literal("declined").optional(),
});

export const acceptTreatmentPlanSchema = z.object({
  signature_image: z.string().nullable().optional(),
});

export const createPhaseSchema = z.object({
  name: z.string().min(1),
  note: z.string().nullable().optional(),
});

export const reorderSchema = z.object({
  sequence: z.number().int().min(0),
});

const newProcedureSchema = z.object({
  procedure_code_id: z.string().uuid(),
  tooth: z.string().min(1).nullable().optional(),
  surfaces: z.array(surfaceEnum).nonempty().nullable().optional(),
  quadrant: z.string().min(1).nullable().optional(),
  arch: z.enum(["upper", "lower"]).nullable().optional(),
  // true: chart it now (real charted_procedure, immediately). false: defer until
  // this plan is accepted. See docs/specs/treatment-planning.md.
  chart_now: z.boolean(),
});

// Exactly one source per item — either an existing charted procedure, or a new one
// (charted now or deferred to accept). See docs/specs/treatment-planning.md's
// "Adding a treatment without charting first".
export const addItemSchema = z.union([
  z.object({ charted_procedure_id: z.string().uuid() }),
  z.object({ new_procedure: newProcedureSchema }),
]);
