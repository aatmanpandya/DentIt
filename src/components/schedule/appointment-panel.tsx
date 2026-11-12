"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { ApiError } from "@/lib/api-client";
import { listPatients, type Patient } from "@/lib/patients-api";
import {
  createAppointment,
  updateAppointment,
  type Appointment,
  type AppointmentType,
  type Operatory,
  type Provider,
} from "@/lib/schedule-api";
import { GRID_SNAP_MINUTES, isoToLocalDateString, localDateTimeToISO, minutesOfDay } from "./time-grid";
import { OVERRIDABLE_CODES } from "./conflict-codes";

export interface AppointmentPanelDraft {
  date: string;
  startMinutes: number;
  endMinutes: number;
  /** Day view always sets this (clicking a specific operatory column); week view
   *  leaves it unset since a day column doesn't imply one. */
  operatoryId?: string;
  /** Week view sets this to whichever provider's week is showing, so creating from
   *  an empty cell doesn't require re-picking the provider you're already looking at. */
  providerId?: string;
}

export function AppointmentPanel({
  open,
  onClose,
  onSaved,
  locationId,
  timeZone,
  operatories,
  providers,
  appointmentTypes,
  draft,
  appointment,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  locationId: string;
  timeZone: string;
  operatories: Operatory[];
  providers: Provider[];
  appointmentTypes: AppointmentType[];
  draft: AppointmentPanelDraft | null;
  appointment: Appointment | null;
}) {
  const editing = Boolean(appointment);
  // The appointment being edited carries its own date (it may not match whatever
  // date/week the parent view is currently showing); for a new appointment the date
  // comes from wherever the user clicked, via the draft.
  const date = appointment ? isoToLocalDateString(appointment.starts_at, timeZone) : (draft?.date ?? "");

  // Lazy initializers rather than a "reset on open" effect: SidePanel unmounts this
  // component entirely while closed (`if (!open) return null`), so every mount already
  // is a fresh open — there's no later point to reset *to*. The parent keys this
  // component by what's being edited (see day-view.tsx), so switching from one
  // appointment straight to another without closing in between also gets a real
  // remount instead of stale state lingering from the previous subject.
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [operatoryId, setOperatoryId] = useState(() => appointment?.operatory_id ?? draft?.operatoryId ?? "");
  const [providerId, setProviderId] = useState(() => appointment?.provider_id ?? draft?.providerId ?? "");
  const [appointmentTypeId, setAppointmentTypeId] = useState(() => appointment?.appointment_type_id ?? "");
  const [startMinutes, setStartMinutes] = useState(() =>
    appointment ? minutesOfDay(appointment.starts_at, timeZone) : (draft?.startMinutes ?? 0),
  );
  const [endMinutes, setEndMinutes] = useState(() =>
    appointment ? minutesOfDay(appointment.ends_at, timeZone) : (draft?.endMinutes ?? 0),
  );
  const [note, setNote] = useState(() => appointment?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    if (!patientQuery.trim()) return;
    const handle = setTimeout(() => {
      listPatients({ q: patientQuery, limit: 8 })
        .then((res) => setPatientResults(res.data))
        .catch(() => setPatientResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [patientQuery]);

  async function submit(override: boolean) {
    setSubmitting(true);
    setError(null);
    if (!override) setWarning(null);

    try {
      if (editing && appointment) {
        await updateAppointment(appointment.id, {
          operatory_id: operatoryId,
          provider_id: providerId,
          starts_at: localDateTimeToISO(date, startMinutes, timeZone),
          ends_at: localDateTimeToISO(date, endMinutes, timeZone),
          note: note || null,
          override,
        });
      } else {
        if (!selectedPatient) {
          setError("Pick a patient first.");
          setSubmitting(false);
          return;
        }
        await createAppointment({
          patient_id: selectedPatient.id,
          location_id: locationId,
          operatory_id: operatoryId,
          provider_id: providerId,
          appointment_type_id: appointmentTypeId || null,
          starts_at: localDateTimeToISO(date, startMinutes, timeZone),
          ends_at: localDateTimeToISO(date, endMinutes, timeZone),
          note: note || null,
          override,
        });
      }
      setWarning(null);
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && OVERRIDABLE_CODES.has(err.code)) {
        setWarning({ code: err.code, message: err.message });
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Couldn't save — try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(false);
  }

  const inputClass =
    "h-9 w-full rounded-[var(--radius)] border border-rule bg-paper px-2.5 text-[13px] text-ink outline-none focus-visible:border-steel";

  return (
    <SidePanel open={open} onClose={onClose} title={editing ? "Edit appointment" : "New appointment"}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Who this appointment is for, and one click to their chart — the schedule is where
            the day starts, so it should lead straight to the patient. */}
        {editing && appointment && (
          <div className="flex items-center justify-between rounded-[var(--radius)] border border-rule bg-paper px-2.5 py-2 text-[13px]">
            <span className="font-medium text-ink">
              {[appointment.patient_first_name, appointment.patient_last_name].filter(Boolean).join(" ") || "Patient"}
            </span>
            <Link href={`/patients/${appointment.patient_id}`} className="text-[12px] font-medium text-steel hover:underline">
              Open chart →
            </Link>
          </div>
        )}
        {!editing && (
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-soft">Patient</label>
            {selectedPatient ? (
              <div className="flex items-center justify-between rounded-[var(--radius)] border border-rule bg-paper px-2.5 py-2 text-[13px]">
                <span>
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </span>
                <button type="button" className="text-[12px] text-steel" onClick={() => setSelectedPatient(null)}>
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  className={inputClass}
                  placeholder="Search by name or phone"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  autoFocus
                />
                {patientQuery.trim() && patientResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-[var(--radius)] border border-rule bg-surface shadow-lg">
                    {patientResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="block w-full px-2.5 py-2 text-left text-[13px] hover:bg-steel-lo"
                          onClick={() => {
                            setSelectedPatient(p);
                            setPatientResults([]);
                          }}
                        >
                          {p.first_name} {p.last_name} · {p.phone}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-soft">Provider</label>
          <select className={inputClass} value={providerId} onChange={(e) => setProviderId(e.target.value)} required>
            <option value="" disabled>
              Select a provider
            </option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-soft">Operatory</label>
          <select className={inputClass} value={operatoryId} onChange={(e) => setOperatoryId(e.target.value)} required>
            <option value="" disabled>
              Select an operatory
            </option>
            {operatories.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-soft">Starts</label>
            <input
              type="time"
              step={GRID_SNAP_MINUTES * 60}
              className={`${inputClass} font-data`}
              value={minutesToTimeInput(startMinutes)}
              onChange={(e) => setStartMinutes(timeInputToMinutes(e.target.value))}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-soft">Ends</label>
            <input
              type="time"
              step={GRID_SNAP_MINUTES * 60}
              className={`${inputClass} font-data`}
              value={minutesToTimeInput(endMinutes)}
              onChange={(e) => setEndMinutes(timeInputToMinutes(e.target.value))}
              required
            />
          </div>
        </div>

        {!editing && (
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-soft">Type (optional)</label>
            <select className={inputClass} value={appointmentTypeId} onChange={(e) => setAppointmentTypeId(e.target.value)}>
              <option value="">No type</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-soft">Note (optional)</label>
          <textarea
            className={`${inputClass} h-20 resize-none py-2`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {warning && (
          <div className="rounded-[var(--radius)] border border-caution bg-[color-mix(in_srgb,var(--caution)_10%,var(--surface))] px-3 py-2.5 text-[13px] text-ink">
            <p>{warning.message}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={submitting}
                className="h-8 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
              >
                Book anyway
              </button>
              <button
                type="button"
                onClick={() => setWarning(null)}
                className="h-8 rounded-[var(--radius)] border border-rule px-3 text-[12px] text-ink hover:bg-steel-lo"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-[13px] text-bleed">{error}</p>}

        {!warning && (
          <button
            type="submit"
            disabled={submitting}
            className="h-9 rounded-[var(--radius)] bg-steel px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : editing ? "Save changes" : "Book appointment"}
          </button>
        )}
      </form>
    </SidePanel>
  );
}

function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeInputToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
