import { apiFetch } from "./api-client";

// Wire types — snake_case, mirroring src/server/lib/serialize-locations.ts and
// src/server/lib/serialize-appointments.ts.

export interface Location {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface Operatory {
  id: string;
  location_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface Provider {
  id: string;
  full_name: string;
  role: string;
  color: string;
  default_operatory_id: string | null;
  qualification: string | null;
}

export interface AppointmentType {
  id: string;
  name: string;
  default_duration_minutes: number;
  color: string;
  is_active: boolean;
}

export interface ScheduleBlock {
  id: string;
  location_id: string | null;
  provider_id: string | null;
  operatory_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string;
}

export interface ProviderScheduleRow {
  id: string;
  provider_id: string;
  location_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_to: string | null;
}

export interface AvailabilitySlot {
  starts_at: string;
  ends_at: string;
}

export type AppointmentStatus = "scheduled" | "confirmed" | "arrived" | "seated" | "completed" | "cancelled" | "no_show";

export interface Appointment {
  id: string;
  location_id: string;
  operatory_id: string;
  patient_id: string;
  provider_id: string;
  appointment_type_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  note: string | null;
  confirmed_at: string | null;
  arrived_at: string | null;
  seated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: "patient" | "practice" | null;
  cancellation_reason: string | null;
  rescheduled_to_id: string | null;
  created_at: string;
  updated_at: string;
  // Present only on rows from listAppointments (the day view's primary read).
  patient_first_name?: string;
  patient_last_name?: string;
}

export const LEGAL_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["seated", "no_show"],
  seated: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function listLocations() {
  return apiFetch<{ data: Location[] }>("/locations");
}

export function listOperatories(locationId: string) {
  return apiFetch<{ data: Operatory[] }>(`/locations/${locationId}/operatories`);
}

export function listProviders() {
  return apiFetch<{ data: Provider[] }>("/providers");
}

export function getProviderSchedule(providerId: string, locationId?: string) {
  const search = locationId ? `?location_id=${locationId}` : "";
  return apiFetch<{ data: ProviderScheduleRow[] }>(`/providers/${providerId}/schedule${search}`);
}

/** Not called by any screen yet — see docs/specs/api-surface.md's "/availability is server-computed" note. */
export function getAvailability(params: { location_id: string; provider_id: string; date: string; duration: number }) {
  const search = new URLSearchParams({
    location_id: params.location_id,
    provider_id: params.provider_id,
    date: params.date,
    duration: String(params.duration),
  });
  return apiFetch<{ data: AvailabilitySlot[] }>(`/availability?${search.toString()}`);
}

export function listAppointmentTypes() {
  return apiFetch<{ data: AppointmentType[] }>("/appointment-types");
}

export function listScheduleBlocks(params: { location_id?: string; from: string; to: string }) {
  const search = new URLSearchParams();
  if (params.location_id) search.set("location_id", params.location_id);
  search.set("from", params.from);
  search.set("to", params.to);
  return apiFetch<{ data: ScheduleBlock[] }>(`/schedule-blocks?${search.toString()}`);
}

export type ListAppointmentsParams =
  | { location_id: string; date: string; provider_id?: string; operatory_id?: string }
  | { location_id: string; from: string; to: string; provider_id?: string; operatory_id?: string };

export function listAppointments(params: ListAppointmentsParams) {
  const search = new URLSearchParams({ location_id: params.location_id });
  if ("date" in params) {
    search.set("date", params.date);
  } else {
    search.set("from", params.from);
    search.set("to", params.to);
  }
  if (params.provider_id) search.set("provider_id", params.provider_id);
  if (params.operatory_id) search.set("operatory_id", params.operatory_id);
  return apiFetch<{ data: Appointment[] }>(`/appointments?${search.toString()}`);
}

export interface CreateAppointmentInput {
  patient_id: string;
  location_id: string;
  operatory_id: string;
  provider_id: string;
  appointment_type_id?: string | null;
  starts_at: string;
  ends_at: string;
  note?: string | null;
  override?: boolean;
}

export function createAppointment(input: CreateAppointmentInput) {
  return apiFetch<Appointment>("/appointments", { method: "POST", body: JSON.stringify(input) });
}

export interface UpdateAppointmentInput {
  operatory_id?: string;
  provider_id?: string;
  starts_at?: string;
  ends_at?: string;
  note?: string | null;
  override?: boolean;
}

export function updateAppointment(id: string, input: UpdateAppointmentInput) {
  return apiFetch<Appointment>(`/appointments/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export interface TransitionAppointmentInput {
  to_status: AppointmentStatus;
  reason?: string;
  cancelled_by?: "patient" | "practice";
}

export function transitionAppointment(id: string, input: TransitionAppointmentInput) {
  return apiFetch<Appointment>(`/appointments/${id}/transition`, { method: "POST", body: JSON.stringify(input) });
}

export interface RescheduleAppointmentInput {
  starts_at: string;
  ends_at: string;
  operatory_id: string;
  provider_id?: string;
  override?: boolean;
}

export function rescheduleAppointment(id: string, input: RescheduleAppointmentInput) {
  return apiFetch<Appointment>(`/appointments/${id}/reschedule`, { method: "POST", body: JSON.stringify(input) });
}
