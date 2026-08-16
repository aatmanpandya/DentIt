import { z } from "zod";

/**
 * Shared between route handlers and (eventually) client-side forms — one definition
 * for the shape, per docs/specs/api-surface.md ("Schemas live in src/server/schemas/").
 * Field names are snake_case, matching the wire format; route handlers translate to
 * the service layer's camelCase at the boundary (see docs/specs/api-surface.md's
 * casing rule).
 */

const procedureCategoryEnum = z.enum([
  "diagnostic",
  "preventive",
  "restorative",
  "endodontic",
  "periodontic",
  "prosthodontic",
  "oral_surgery",
  "orthodontic",
  "implant",
  "cosmetic",
]);

const procedureScopeEnum = z.enum(["mouth", "arch", "quadrant", "tooth", "surface"]);

const taxClassEnum = z.enum(["exempt_healthcare", "gst_5", "gst_18"]);

export const createProcedureCodeSchema = z.object({
  code: z.string().min(1),
  short_name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: procedureCategoryEnum,
  applies_to: procedureScopeEnum,
  surfaces_required: z.boolean().optional(),
  tax_class: taxClassEnum.optional(),
  cdt_equivalent: z.string().nullable().optional(),
});

export const updateProcedureCodeSchema = createProcedureCodeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const listProcedureCodesQuerySchema = z.object({
  category: procedureCategoryEnum.optional(),
  q: z.string().min(1).optional(),
  active: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const createFeeScheduleSchema = z.object({
  name: z.string().min(1),
  location_id: z.string().uuid().nullable().optional(),
  effective_from: z.string().date(),
  effective_to: z.string().date().nullable().optional(),
  is_default: z.boolean().optional(),
});

const feeScheduleItemInputSchema = z.object({
  procedure_code_id: z.string().uuid(),
  price: z.string().regex(/^\d+\.\d{2}$/, "price must be a decimal string like \"300.00\""),
});

export const upsertFeeScheduleItemsSchema = z.object({
  items: z.array(feeScheduleItemInputSchema).min(1),
});

export const pricingQuerySchema = z.object({
  procedure_code_id: z.string().uuid(),
  location_id: z.string().uuid().optional(),
  on_date: z.string().date().optional(),
});
