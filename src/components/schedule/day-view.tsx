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
import {
  gridHours,
  gridHeightPx,
  GRID_SNAP_MINUTES,
  minutesToY,
  yToMinutes,
  snapMinutes,
  formatTimeLabel,
  minutesOfDay,
  localDateTimeToISO,
  computeGridRange,
  dayOfWeekOfDateStr,
} from "./time-grid";
import { OVERRIDABLE_CODES } from "./conflict-codes";

// Stable references for the "no data yet" fallback — `?? []` alone creates a new array
// every render, which defeats useMemo's dependency check below.
const EMPTY: never[] = [];

export function DayView({ locationId, date, providerId = null }: { locationId: string; date: string; providerId?: string | null }) {
  const { user } = useAuth();
  const timeZone = user?.organization.timezone ?? "Asia/Kolkata";
  const queryClient = useQueryClient();
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeState = useRef<{ appointment: Appointment; startY: number; originalEnd: number } | null>(null);

  const operatoriesQuery = useQuery({ queryKey: ["operatories", locationId], queryFn: () => listOperatories(locationId) });
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const typesQuery = useQuery({ queryKey: ["appointment-types"], queryFn: listAppointmentTypes });
  const blocksQuery = useQuery({
    queryKey: ["schedule-blocks", locationId, date],
    queryFn: () => listScheduleBlocks({ location_id: locationId, from: date, to: date }),
  });
  const appointmentsQuery = useQuery({
    queryKey: ["appointments", locationId, date],
    queryFn: () => listAppointments({ location_id: locationId, date }),
  });

  const operatories = operatoriesQuery.data?.data ?? EMPTY;
  const providers = providersQuery.data?.data ?? EMPTY;
  const appointmentTypes = typesQuery.data?.data ?? EMPTY;
  const blocks = blocksQuery.data?.data ?? EMPTY;
  const allAppointments = appointmentsQuery.data?.data ?? EMPTY;
  // null providerId = "All" — every provider's appointments shown together across
  // their operatory columns (double-booking a single operatory is already impossible,
  // hard-blocked by the DB, so "All" never needs the week view's overlap splitting).
  const appointments = useMemo(
    () => (providerId ? allAppointments.filter((a) => a.provider_id === providerId) : allAppointments),
    [allAppointments, providerId],
  );

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);

  // Grid range derived from provider hours on this day of week, padded an hour,
  // falling back to the fixed 8am-8pm range — see computeGridRange in time-grid.ts.
  // Aggregated across every provider when showing "All"; narrowed to just the
  // selected provider's hours otherwise, same as the week view does for its one
  // provider.
  const schedulesByProvider = useProviderSchedules(providers, locationId);
  const dayOfWeek = dayOfWeekOfDateStr(date);
  const range = useMemo(() => {
    const relevantProviders = providerId ? providers.filter((p) => p.id === providerId) : providers;
    const rows = relevantProviders.flatMap((p) => (schedulesByProvider.get(p.id) ?? []).filter((r) => r.day_of_week === dayOfWeek));
    return computeGridRange(rows.map((r) => ({ startTime: r.start_time, endTime: r.end_time })));
  }, [providers, providerId, schedulesByProvider, dayOfWeek]);

  // null = "All" — every operatory rendered side by side, the original day-view spec.
  // Picking a specific operatory narrows the grid to just that column, full width, for
  // clinics with more operatories than comfortably fit on screen at once.
  const [focusedOperatoryId, setFocusedOperatoryId] = useState<string | null>(null);
  const visibleOperatories = useMemo(
    () => (focusedOperatoryId ? operatories.filter((o) => o.id === focusedOperatoryId) : operatories),
    [operatories, focusedOperatoryId],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resizingHeight, setResizingHeight] = useState<{ id: string; endMinutes: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDraft, setPanelDraft] = useState<AppointmentPanelDraft | null>(null);
  const [panelAppointment, setPanelAppointment] = useState<Appointment | null>(null);
  // Bumped only by openCreate/openEdit — gives AppointmentPanel a key that changes
  // exactly when the user opens a *new* subject (including switching straight from one
  // appointment to another without closing in between), never on an unrelated re-render.
  const [panelSession, setPanelSession] = useState(0);
  const [banner, setBanner] = useState<{ kind: "error" | "warning"; message: string; retry?: () => void } | null>(null);

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ["appointments", locationId, date] });
  }

  function openCreate(operatoryId: string, startMinutes: number) {
    setPanelAppointment(null);
    setPanelDraft({ date, operatoryId, startMinutes: snapMinutes(startMinutes), endMinutes: snapMinutes(startMinutes) + 30 });
    setPanelSession((n) => n + 1);
    setPanelOpen(true);
  }

  function openEdit(appt: Appointment) {
    setPanelAppointment(appt);
    setPanelDraft(null);
    setPanelSession((n) => n + 1);
    setPanelOpen(true);
  }

  async function applyChange(
    appt: Appointment,
    change: { operatory_id?: string; starts_at?: string; ends_at?: string },
    override: boolean,
  ) {
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
    if (!appt || !gridRef.current || visibleOperatories.length === 0) return;

    const columnWidth = gridRef.current.clientWidth / visibleOperatories.length;
    const startMinutes = minutesOfDay(appt.starts_at, timeZone);
    const endMinutes = minutesOfDay(appt.ends_at, timeZone);
    const duration = endMinutes - startMinutes;

    const columnShift = Math.round(event.delta.x / columnWidth);
    const currentIndex = visibleOperatories.findIndex((o) => o.id === appt.operatory_id);
    const newIndex = Math.min(Math.max(currentIndex + columnShift, 0), visibleOperatories.length - 1);
    const newOperatoryId = visibleOperatories[newIndex]?.id ?? appt.operatory_id;

    const newStart = yToMinutes(minutesToY(startMinutes, range) + event.delta.y, range);
    const newEnd = newStart + duration;

    if (newOperatoryId === appt.operatory_id && newStart === startMinutes) return;

    applyChange(
      appt,
      {
        operatory_id: newOperatoryId,
        starts_at: localDateTimeToISO(date, newStart, timeZone),
        ends_at: localDateTimeToISO(date, newEnd, timeZone),
      },
      false,
    );
  }

  function handleResizeStart(appt: Appointment, e: ReactPointerEvent) {
    const originalEnd = minutesOfDay(appt.ends_at, timeZone);
    resizeState.current = { appointment: appt, startY: e.clientY, originalEnd };
    setResizingHeight({ id: appt.id, endMinutes: originalEnd });

    function onMove(ev: PointerEvent) {
      if (!resizeState.current) return;
      const deltaY = ev.clientY - resizeState.current.startY;
      const startMinutes = minutesOfDay(resizeState.current.appointment.starts_at, timeZone);
      const newEnd = Math.max(
        yToMinutes(minutesToY(resizeState.current.originalEnd, range) + deltaY, range),
        startMinutes + GRID_SNAP_MINUTES,
      );
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
          applyChange(state.appointment, { ends_at: localDateTimeToISO(date, current.endMinutes, timeZone) }, false);
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

    const startMinutes = minutesOfDay(appt.starts_at, timeZone);
    const endMinutes = minutesOfDay(appt.ends_at, timeZone);
    const duration = endMinutes - startMinutes;
    const currentIndex = visibleOperatories.findIndex((o) => o.id === appt.operatory_id);

    if (e.key === "ArrowUp" && !e.shiftKey) {
      e.preventDefault();
      const newStart = snapMinutes(startMinutes - GRID_SNAP_MINUTES);
      applyChange(appt, { starts_at: localDateTimeToISO(date, newStart, timeZone), ends_at: localDateTimeToISO(date, newStart + duration, timeZone) }, false);
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      e.preventDefault();
      const newStart = snapMinutes(startMinutes + GRID_SNAP_MINUTES);
      applyChange(appt, { starts_at: localDateTimeToISO(date, newStart, timeZone), ends_at: localDateTimeToISO(date, newStart + duration, timeZone) }, false);
    } else if (e.key === "ArrowLeft" && currentIndex > 0) {
      e.preventDefault();
      applyChange(appt, { operatory_id: visibleOperatories[currentIndex - 1].id }, false);
    } else if (e.key === "ArrowRight" && currentIndex < visibleOperatories.length - 1) {
      e.preventDefault();
      applyChange(appt, { operatory_id: visibleOperatories[currentIndex + 1].id }, false);
    } else if (e.key === "ArrowDown" && e.shiftKey) {
      e.preventDefault();
      const newEnd = Math.max(snapMinutes(endMinutes + GRID_SNAP_MINUTES), startMinutes + GRID_SNAP_MINUTES);
      applyChange(appt, { ends_at: localDateTimeToISO(date, newEnd, timeZone) }, false);
    } else if (e.key === "ArrowUp" && e.shiftKey) {
      e.preventDefault();
      const newEnd = Math.max(snapMinutes(endMinutes - GRID_SNAP_MINUTES), startMinutes + GRID_SNAP_MINUTES);
      applyChange(appt, { ends_at: localDateTimeToISO(date, newEnd, timeZone) }, false);
    }
  }

  function handleColumnClick(operatoryId: string, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    openCreate(operatoryId, yToMinutes(y, range));
  }

  if (operatoriesQuery.isLoading || appointmentsQuery.isLoading) {
    return <div className="flex-1" aria-hidden />;
  }

  if (operatories.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[13px] text-ink">No operatories set up for this location yet.</p>
      </div>
    );
  }

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

      {operatories.length > 1 && (
        <div className="flex flex-none items-center gap-1 border-b border-rule bg-paper px-4 py-1.5">
          <button
            type="button"
            onClick={() => setFocusedOperatoryId(null)}
            className={`h-7 rounded-[var(--radius)] px-3 text-[12px] font-medium ${
              focusedOperatoryId === null ? "bg-steel text-white" : "text-ink-soft hover:bg-steel-lo hover:text-ink"
            }`}
          >
            All
          </button>
          {operatories.map((op) => (
            <button
              key={op.id}
              type="button"
              onClick={() => setFocusedOperatoryId(op.id)}
              className={`h-7 rounded-[var(--radius)] px-3 text-[12px] font-medium ${
                focusedOperatoryId === op.id ? "bg-steel text-white" : "text-ink-soft hover:bg-steel-lo hover:text-ink"
              }`}
            >
              {op.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-none border-b border-rule bg-surface">
        <div className="w-14 flex-none" />
        {visibleOperatories.map((op) => (
          <div key={op.id} className="flex-1 border-l border-rule px-2 py-2 text-center font-condensed text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            {op.name}
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

              {visibleOperatories.map((op) => {
                const opBlocks = blocks.filter((b) => !b.operatory_id || b.operatory_id === op.id);
                const opAppointments = appointments.filter((a) => a.operatory_id === op.id);
                return (
                  <div key={op.id} className="relative flex-1 cursor-pointer border-l border-rule" onClick={(e) => handleColumnClick(op.id, e)}>
                    {opBlocks.map((b) => {
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

                    {opAppointments.map((appt) => {
                      const patientName =
                        appt.patient_first_name || appt.patient_last_name
                          ? `${appt.patient_first_name ?? ""} ${appt.patient_last_name ?? ""}`.trim()
                          : "Patient";
                      return (
                        <AppointmentBlock
                          key={appt.id}
                          appointment={appt}
                          overrideEndMinutes={resizingHeight?.id === appt.id ? resizingHeight.endMinutes : undefined}
                          provider={providerById.get(appt.provider_id)}
                          patientName={patientName}
                          timeZone={timeZone}
                          range={range}
                          selected={selectedId === appt.id}
                          onSelect={() => setSelectedId(appt.id)}
                          onOpen={() => openEdit(appt)}
                          onChanged={refetch}
                          onResizeStart={(e) => handleResizeStart(appt, e)}
                          onKeyDown={(e) => handleBlockKeyDown(appt, e)}
                        />
                      );
                    })}
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
