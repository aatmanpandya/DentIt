import { z } from "zod";

/**
 * Shared between route handlers and (eventually) client-side forms — one definition
 * for the shape, per docs/specs/api-surface.md ("Schemas live in src/server/schemas/").
 * Field names are snake_case, matching the wire format; route handlers translate to
 * the service layer's camelCase at the boundary (see docs/specs/api-surface.md's
 * casing rule).
 */

const responsiblePartySchema = z.object({
  full_name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().nullable().optional(),
  relationship: z.string().min(1),
  address_line1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
});

// Only name and phone are required — see docs/specs/ui-design.md's patient add/edit
// screen note. date_of_birth is nullable deliberately: patients often don't know or
// won't give it, and blocking registration on it makes front desk enter garbage.
export const createPatientSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  date_of_birth: z.string().date().nullable().optional(),
  sex: z.enum(["male", "female", "other"]).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address_line1: z.string().nullable().optional(),
  address_line2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  preferred_location_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  responsible_party: responsiblePartySchema.nullable().optional(),
});

export const updatePatientSchema = createPatientSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const listPatientsQuerySchema = z.object({
  q: z.string().min(1).optional(),
  location_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const createPatientAlertSchema = z.object({
  alert_type: z.enum(["allergy", "medical", "precaution"]),
  label: z.string().min(1),
  detail: z.string().nullable().optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
});

export const updatePatientAlertSchema = z.object({
  label: z.string().min(1).optional(),
  detail: z.string().nullable().optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  is_active: z.boolean().optional(),
});
