import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-catalog.ts.
export interface ProcedureCode {
  id: string;
  code: string;
  short_name: string;
  description: string | null;
  category:
    | "diagnostic"
    | "preventive"
    | "restorative"
    | "endodontic"
    | "periodontic"
    | "prosthodontic"
    | "oral_surgery"
    | "orthodontic"
    | "implant"
    | "cosmetic";
  applies_to: "mouth" | "arch" | "quadrant" | "tooth" | "surface";
  surfaces_required: boolean;
  tax_class: "exempt_healthcare" | "gst_5" | "gst_18";
  cdt_equivalent: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcedureCodeInput {
  code: string;
  short_name: string;
  description?: string | null;
  category: ProcedureCode["category"];
  applies_to: ProcedureCode["applies_to"];
  surfaces_required?: boolean;
  tax_class?: ProcedureCode["tax_class"];
  cdt_equivalent?: string | null;
}

export const PROCEDURE_CATEGORIES: ProcedureCode["category"][] = [
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
];

export const PROCEDURE_SCOPES: ProcedureCode["applies_to"][] = ["mouth", "arch", "quadrant", "tooth", "surface"];

export function listProcedureCodes(params: { category?: string; q?: string; active?: boolean; cursor?: string; limit?: number } = {}) {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.q) search.set("q", params.q);
  if (params.active !== undefined) search.set("active", String(params.active));
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch<{ data: ProcedureCode[]; next_cursor: string | null }>(`/procedure-codes${qs ? `?${qs}` : ""}`);
}

export function createProcedureCode(input: ProcedureCodeInput) {
  return apiFetch<ProcedureCode>("/procedure-codes", { method: "POST", body: JSON.stringify(input) });
}

export function updateProcedureCode(id: string, input: Partial<ProcedureCodeInput> & { is_active?: boolean }) {
  return apiFetch<ProcedureCode>(`/procedure-codes/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function importStarterTemplate() {
  return apiFetch<{ data: ProcedureCode[] }>("/procedure-codes/import-starter", { method: "POST" });
}
