import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-catalog.ts.
export interface FeeSchedule {
  id: string;
  name: string;
  location_id: string | null;
  effective_from: string;
  effective_to: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeeScheduleItem {
  id: string;
  fee_schedule_id: string;
  procedure_code_id: string;
  price: string;
  created_at: string;
  updated_at: string;
}

export interface FeeScheduleInput {
  name: string;
  location_id?: string | null;
  effective_from: string;
  effective_to?: string | null;
  is_default?: boolean;
}

export function listFeeSchedules() {
  return apiFetch<{ data: FeeSchedule[] }>("/fee-schedules");
}

export function createFeeSchedule(input: FeeScheduleInput) {
  return apiFetch<FeeSchedule>("/fee-schedules", { method: "POST", body: JSON.stringify(input) });
}

export function listFeeScheduleItems(feeScheduleId: string) {
  return apiFetch<{ data: FeeScheduleItem[] }>(`/fee-schedules/${feeScheduleId}/items`);
}

// Bulk upsert — the editor saves the whole grid in one atomic request. Items missing
// from the payload are left alone, not deleted — see docs/specs/api-surface.md.
export function upsertFeeScheduleItems(feeScheduleId: string, items: { procedure_code_id: string; price: string }[]) {
  return apiFetch<{ data: FeeScheduleItem[] }>(`/fee-schedules/${feeScheduleId}/items`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export function getPricing(params: { procedure_code_id: string; location_id?: string; on_date?: string }) {
  const search = new URLSearchParams({ procedure_code_id: params.procedure_code_id });
  if (params.location_id) search.set("location_id", params.location_id);
  if (params.on_date) search.set("on_date", params.on_date);
  return apiFetch<{ procedure_code_id: string; fee_schedule_id: string; price: string }>(`/pricing?${search.toString()}`);
}
