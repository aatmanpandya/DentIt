"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api-client";
import {
  listOperatories,
  listProviders,
  listAppointmentTypes,
  listScheduleBlocks,
  listAppointments,
  updateAppointment,
  type Appointment,
} from "@/lib/schedule-api";
import { AppointmentBlock } from "./appointment-block";
import { AppointmentPanel, type AppointmentPanelDraft } from "./appointment-panel";
import { useProviderSchedules } from "./use-provider-schedules";
import { OVERRIDABLE_CODES } from "./conflict-codes";
import { weekGridDays, WEEKDAY_LABELS, dayOfMonthLabel } from "./date-grid";
import {
  gridHours,
  gridHeightPx,
  GRID_SNAP_MINUTES,
  minutesToY,
  yToMinutes,
  snapMinutes,
  formatTimeLabel,
  minutesOfDay,
  isoToLocalDateString,
  localDateTimeToISO,
  computeGridRange,
  layoutOverlaps,
} from "./time-grid";

const EMPTY: never[] = [];

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * One provider's full week — or, with providerId null, every provider's — day columns
 * instead of the day view's operatory columns. Same interaction model throughout
 * (drag-to-move, drag-to-resize, full keyboard parity), grilled to match rather than a
 * lighter read-only variant. Moving an appointment here only ever changes its
 * day/time, never its operatory or provider: the operatory is a spatial resource that
 * doesn't depend on which day it is, so drag/keyboard moves carry it forward
 * unchanged, same as changing only the note would.
 */
export function WeekView({ locationId, date, providerId }: { locationId: string; date: string; providerId: string | null }) {
  const { user } = useAuth();
  const timeZone = user?.organization.timezone ?? "Asia/Kolkata";
  const queryClient = useQueryClient();
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeState = useRef<{ appointment: Appointment; startY: number; originalEnd: number } | null>(null);

  const weekDays = useMemo(() => weekGridDays(date), [date]);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];

  const operatoriesQuery = useQuery({ queryKey: ["operatories", locationId], queryFn: () => listOperatories(locationId) });
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const typesQuery = useQuery({ queryKey: ["appointment-types"], queryFn: listAppointmentTypes });
  const blocksQuery = useQuery({
    queryKey: ["schedule-blocks", locationId, weekStart, weekEnd],
    queryFn: () => listScheduleBlocks({ location_id: locationId, from: weekStart, to: weekEnd }),
  });
  const appointmentsQuery = useQuery({
    queryKey: ["appointments", locationId, "week", weekStart, weekEnd, providerId ?? "all"],
    queryFn: () =>
      listAppointments(
        providerId
          ? { location_id: locationId, from: weekStart, to: weekEnd, provider_id: providerId }
          : { location_id: locationId, from: weekStart, to: weekEnd },
      ),
  });

  const operatories = operatoriesQuery.data?.data ?? EMPTY;
  const providers = providersQuery.data?.data ?? EMPTY;
  const appointmentTypes = typesQuery.data?.data ?? EMPTY;
  const blocks = blocksQuery.data?.data ?? EMPTY;
  const appointments = appointmentsQuery.data?.data ?? EMPTY;

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const provider = providerId ? providerById.get(providerId) : undefined;

  // One range for the whole week (not one per day) so blocks line up vertically across
  // columns — padded around the widest hours over all seven days, falling back to
  // 8am-8pm if there's no schedule to derive from. Just the selected provider's hours
  // when one is picked; every provider's, aggregated, under "All" — same relationship
  // the day view has between a single-provider filter and its own "All" aggregate.
  const schedulesByProvider = useProviderSchedules(providerId ? (provider ? [provider] : EMPTY) : providers, locationId);
  const range = useMemo(() => {
    const relevantProviders = providerId ? (provider ? [provider] : EMPTY) : providers;
    const rows = relevantProviders.flatMap((p) => schedulesByProvider.get(p.id) ?? []);
    return computeGridRange(rows.map((r) => ({ startTime: r.start_time, endTime: r.end_time })));
  }, [providerId, provider, providers, schedulesByProvider]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resizingHeight, setResizingHeight] = useState<{ id: string; endMinutes: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDraft, setPanelDraft] = useState<AppointmentPanelDraft | null>(null);
  const [panelAppointment, setPanelAppointment] = useState<Appointment | null>(null);
  const [panelSession, setPanelSession] = useState(0);
  const [banner, setBanner] = useState<{ kind: "error" | "warning"; message: string; retry?: () => void } | null>(null);

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ["appointments", locationId, "week", weekStart, weekEnd, providerId ?? "all"] });
  }

  function openCreate(dayDate: string, startMinutes: number) {
    setPanelAppointment(null);
    // Only pre-fills a provider when the week view itself is scoped to one — under
    // "All" there's no single provider to default to, same as the day view's create
    // panel never presets a provider either.
    setPanelDraft({
      date: dayDate,
      providerId: providerId ?? undefined,
      startMinutes: snapMinutes(startMinutes),
      endMinutes: snapMinutes(startMinutes) + 30,
    });
    setPanelSession((n) => n + 1);
    setPanelOpen(true);
  }

  function openEdit(appt: Appointment) {
    setPanelAppointment(appt);
    setPanelDraft(null);
    setPanelSession((n) => n + 1);
    setPanelOpen(true);
  }

  async function applyChange(appt: Appointment, change: { starts_at?: string; ends_at?: string }, override: boolean) {
    try {
      await updateAppointment(appt.id, { ...change, override });
      setBanner(null);
      refetch();
    } catch (err) {
      if (err instanceof ApiError && OVERRIDABLE_CODES.has(err.code)) {
        setBanner({ kind: "warning", message: err.message, retry: () => applyChange(appt, change, true) });
      } else {
        setBanner({ kind: "error", message: err instanceof ApiError ? err.message : "Couldn't save — try again." });
        setTimeout(() => setBanner((b) => (b?.kind === "error" ? null : b)), 3000);
      }
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const appt = event.active.data.current?.appointment as Appointment | undefined;
    if (!appt || !gridRef.current) return;

    const columnWidth = gridRef.current.clientWidth / weekDays.length;
    const apptDate = isoToLocalDateString(appt.starts_at, timeZone);
    const startMinutes = minutesOfDay(appt.starts_at, timeZone);
    const endMinutes = minutesOfDay(appt.ends_at, timeZone);
    const duration = endMinutes - startMinutes;

    const columnShift = Math.round(event.delta.x / columnWidth);
    const currentIndex = weekDays.indexOf(apptDate);
    const newIndex = Math.min(Math.max(currentIndex + columnShift, 0), weekDays.length - 1);
    const newDate = weekDays[newIndex] ?? apptDate;

    const newStart = yToMinutes(minutesToY(startMinutes, range) + event.delta.y, range);
    const newEnd = newStart + duration;

    if (newDate === apptDate && newStart === startMinutes) return;

    applyChange(appt, { starts_at: localDateTimeToISO(newDate, newStart, timeZone), ends_at: localDateTimeToISO(newDate, newEnd, timeZone) }, false);
  }

  function handleResizeStart(appt: Appointment, e: ReactPointerEvent) {
    const apptDate = isoToLocalDateString(appt.starts_at, timeZone);
    const originalEnd = minutesOfDay(appt.ends_at, timeZone);
    resizeState.current = { appointment: appt, startY: e.clientY, originalEnd };
    setResizingHeight({ id: appt.id, endMinutes: originalEnd });

    function onMove(ev: PointerEvent) {
      if (!resizeState.current) return;
      const deltaY = ev.clientY - resizeState.current.startY;
      const startMinutes = minutesOfDay(resizeState.current.appointment.starts_at, timeZone);
      const newEnd = Math.max(yToMinutes(minutesToY(resizeState.current.originalEnd, range) + deltaY, range), startMinutes + GRID_SNAP_MINUTES);
      setResizingHeight({ id: resizeState.current.appointment.id, endMinutes: newEnd });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const state = resizeState.current;
      resizeState.current = null;
      if (!state) return;
      setResizingHeight((current) => {
        if (current && current.endMinutes !== state.originalEnd) {
          applyChange(state.appointment, { ends_at: localDateTimeToISO(apptDate, current.endMinutes, timeZone) }, false);
        }
        return null;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleBlockKeyDown(appt: Appointment, e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      openEdit(appt);
      return;
    }
    if (e.key === "Escape") {
      (e.target as HTMLElement).blur();
      return;
    }

    const apptDate = isoToLocalDateString(appt.starts_at, timeZone);
    const startMinutes = minutesOfDay(appt.starts_at, timeZone);
    const endMinutes = minutesOfDay(appt.ends_at, timeZone);
    const duration = endMinutes - startMinutes;
    const currentIndex = weekDays.indexOf(apptDate);

    if (e.key === "ArrowUp" && !e.shiftKey) {
      e.preventDefault();
      const newStart = snapMinutes(startMinutes - GRID_SNAP_MINUTES);
      applyChange(appt, { starts_at: localDateTimeToISO(apptDate, newStart, timeZone), ends_at: localDateTimeToISO(apptDate, newStart + duration, timeZone) }, false);
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      e.preventDefault();
      const newStart = snapMinutes(startMinutes + GRID_SNAP_MINUTES);
      applyChange(appt, { starts_at: localDateTimeToISO(apptDate, newStart, timeZone), ends_at: localDateTimeToISO(apptDate, newStart + duration, timeZone) }, false);
    } else if (e.key === "ArrowLeft" && currentIndex > 0) {
      e.preventDefault();
      const newDate = weekDays[currentIndex - 1];
      applyChange(appt, { starts_at: localDateTimeToISO(newDate, startMinutes, timeZone), ends_at: localDateTimeToISO(newDate, endMinutes, timeZone) }, false);
    } else if (e.key === "ArrowRight" && currentIndex < weekDays.length - 1) {
      e.preventDefault();
      const newDate = weekDays[currentIndex + 1];
      applyChange(appt, { starts_at: localDateTimeToISO(newDate, startMinutes, timeZone), ends_at: localDateTimeToISO(newDate, endMinutes, timeZone) }, false);
    } else if (e.key === "ArrowDown" && e.shiftKey) {
      e.preventDefault();
      const newEnd = Math.max(snapMinutes(endMinutes + GRID_SNAP_MINUTES), startMinutes + GRID_SNAP_MINUTES);
      applyChange(appt, { ends_at: localDateTimeToISO(apptDate, newEnd, timeZone) }, false);
    } else if (e.key === "ArrowUp" && e.shiftKey) {
      e.preventDefault();
      const newEnd = Math.max(snapMinutes(endMinutes - GRID_SNAP_MINUTES), startMinutes + GRID_SNAP_MINUTES);
      applyChange(appt, { ends_at: localDateTimeToISO(apptDate, newEnd, timeZone) }, false);
    }
  }

  function handleColumnClick(dayDate: string, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    openCreate(dayDate, yToMinutes(y, range));
  }

  if (!providersQuery.isLoading && providers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[13px] text-ink">No providers set up for this location yet.</p>
      </div>
    );
  }

  if (operatoriesQuery.isLoading || appointmentsQuery.isLoading) {
    return <div className="flex-1" aria-hidden />;
  }

  const today = todayStr();

  return (
    <div className="flex h-full flex-col">
      {banner && (
        <div
          className={`flex flex-none items-center justify-between gap-3 border-b px-4 py-2 text-[13px] ${
            banner.kind === "error" ? "border-bleed/30 bg-[color-mix(in_srgb,var(--bleed)_8%,var(--surface))] text-ink" : "border-caution/30 bg-[color-mix(in_srgb,var(--caution)_10%,var(--surface))] text-ink"
          }`}
        >
          <span>{banner.message}</span>
          {banner.retry && (
            <div className="flex flex-none gap-2">
              <button
                type="button"
                onClick={banner.retry}
                className="h-7 rounded-[var(--radius)] bg-steel px-3 text-[12px] font-medium text-white hover:opacity-90"
              >
                Book anyway
              </button>
              <button type="button" onClick={() => setBanner(null)} className="h-7 rounded-[var(--radius)] border border-rule px-3 text-[12px] text-ink">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-none border-b border-rule bg-surface">
        <div className="w-14 flex-none" />
        {weekDays.map((d, i) => (
          <div
            key={d}
            className={`flex-1 border-l border-rule px-2 py-2 text-center font-condensed text-[11px] font-semibold uppercase tracking-wide ${
              d === today ? "bg-[color-mix(in_srgb,var(--steel)_8%,var(--surface))] text-steel" : "text-ink-soft"
            }`}
          >
            {WEEKDAY_LABELS[i]} <span className="font-data normal-case">{dayOfMonthLabel(d)}</span>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="relative flex" style={{ height: gridHeightPx(range) }}>
            <div className="relative w-14 flex-none">
              {gridHours(range).map((m) => (
                <div key={m} className="absolute -translate-y-1/2 pr-2 text-right font-data text-[11px] text-ink-soft" style={{ top: minutesToY(m, range), right: 0 }}>
                  {formatTimeLabel(m)}
                </div>
              ))}
            </div>

            <div ref={gridRef} className="relative flex flex-1">
              {gridHours(range).map((m) => (
                <div key={m} className="pointer-events-none absolute left-0 right-0 border-t border-rule" style={{ top: minutesToY(m, range) }} />
              ))}

              {weekDays.map((d) => {
                const dayBlocks = blocks.filter(
                  (b) => !b.operatory_id && (!b.provider_id || !providerId || b.provider_id === providerId) && isoToLocalDateString(b.starts_at, timeZone) === d,
                );
                const dayAppointments = appointments.filter((a) => isoToLocalDateString(a.starts_at, timeZone) === d);
                return (
                  <div key={d} className="relative flex-1 cursor-pointer border-l border-rule" onClick={(e) => handleColumnClick(d, e)}>
                    {dayBlocks.map((b) => {
                      const startMinutes = minutesOfDay(b.starts_at, timeZone);
                      const endMinutes = minutesOfDay(b.ends_at, timeZone);
                      return (
                        <div
                          key={b.id}
                          className="pointer-events-none absolute inset-x-0 flex items-start justify-center bg-[repeating-linear-gradient(135deg,var(--rule)_0px,var(--rule)_1px,transparent_1px,transparent_6px)] text-[11px] text-ink-soft"
                          style={{ top: minutesToY(startMinutes, range), height: minutesToY(endMinutes, range) - minutesToY(startMinutes, range) }}
                        >
                          {b.reason}
                        </div>
                      );
                    })}

                    {(() => {
                      // Same provider, different operatory, overlapping time is a real
                      // shape the backend allows (APPOINTMENT_PROVIDER_CONFLICT is a
                      // warn-with-override, not a hard block) — the week view's day
                      // columns have no operatory sub-division to keep those apart the
                      // way the day view's columns do, so lay overlaps out side by side.
                      const overlapLayout = layoutOverlaps(
                        dayAppointments.map((a) => ({
                          id: a.id,
                          startMinutes: minutesOfDay(a.starts_at, timeZone),
                          endMinutes: resizingHeight?.id === a.id ? resizingHeight.endMinutes : minutesOfDay(a.ends_at, timeZone),
                        })),
                      );
                      return dayAppointments.map((appt) => {
                        const patientName =
                          appt.patient_first_name || appt.patient_last_name
                            ? `${appt.patient_first_name ?? ""} ${appt.patient_last_name ?? ""}`.trim()
                            : "Patient";
                        const lane = overlapLayout.get(appt.id) ?? { lane: 0, laneCount: 1 };
                        return (
                          <AppointmentBlock
                            key={appt.id}
                            appointment={appt}
                            overrideEndMinutes={resizingHeight?.id === appt.id ? resizingHeight.endMinutes : undefined}
                            provider={providerById.get(appt.provider_id)}
                            patientName={patientName}
                            timeZone={timeZone}
                            range={range}
                            laneIndex={lane.lane}
                            laneCount={lane.laneCount}
                            selected={selectedId === appt.id}
                            onSelect={() => setSelectedId(appt.id)}
                            onOpen={() => openEdit(appt)}
                            onChanged={refetch}
                            onResizeStart={(e) => handleResizeStart(appt, e)}
                            onKeyDown={(e) => handleBlockKeyDown(appt, e)}
                          />
                        );
                      });
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </DndContext>
      </div>

      <AppointmentPanel
        key={panelSession}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSaved={refetch}
        locationId={locationId}
        timeZone={timeZone}
        operatories={operatories}
        providers={providers}
        appointmentTypes={appointmentTypes}
        draft={panelDraft}
        appointment={panelAppointment}
      />
    </div>
  );
}
