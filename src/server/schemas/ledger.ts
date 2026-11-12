import { z } from "zod";

// Money is a decimal string with at most two places — never a number (CLAUDE.md).
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50.");
const signedMoney = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Enter an amount like -200 or 150.50.");

export const createInvoiceSchema = z.object({
  patient_id: z.string().uuid(),
  location_id: z.string().uuid(),
  charted_procedure_ids: z.array(z.string().uuid()).min(1, "Choose at least one treatment."),
  prices: z.record(z.string().uuid(), money).optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for voiding."),
});

const allocation = z.object({ invoice_id: z.string().uuid(), amount: money });

export const recordPaymentSchema = z.object({
  patient_id: z.string().uuid(),
  location_id: z.string().uuid(),
  amount: money,
  method: z.enum(["cash", "card", "upi", "bank_transfer", "cheque", "other"]),
  reference: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  allocations: z.array(allocation).optional(),
});

export const applyCreditSchema = z.object({
  patient_id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  amount: money,
});

export const createAdjustmentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: signedMoney,
  adjustment_type: z.enum(["discount", "writeoff", "correction"]),
  reason: z.string().trim().min(1, "Give a reason for the adjustment."),
});

export const suggestLocationQuerySchema = z.object({
  patient_id: z.string().uuid(),
  charted_procedure_ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.string().uuid())),
});
