"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type { Appointment, Provider } from "@/lib/schedule-api";
import { StatusPill } from "./status-pill";
import { minutesOfDay, minutesToY, durationToHeight, formatTimeLabel, DEFAULT_GRID_RANGE, type GridRange } from "./time-grid";

export function AppointmentBlock({
  appointment,
  provider,
  patientName,
  timeZone,
  selected,
  onSelect,
  onOpen,
  onChanged,
  onResizeStart,
  onKeyDown,
  overrideEndMinutes,
  range = DEFAULT_GRID_RANGE,
  laneIndex = 0,
  laneCount = 1,
}: {
  appointment: Appointment;
  provider: Provider | undefined;
  patientName: string;
  timeZone: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onChanged: () => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Live end-time while a resize drag is in progress, in minutes-of-day — bypasses
   *  appointment.ends_at so the preview doesn't need a fake timestamp round-trip. */
  overrideEndMinutes?: number;
  /** The grid's displayed time range — see computeGridRange in time-grid.ts. Defaults
   *  to the fixed 8am-8pm range for callers that haven't derived one. */
  range?: GridRange;
  /** Horizontal sub-column, for columns that can hold overlapping appointments (the
   *  week view) — see layoutOverlaps in time-grid.ts. The day view never needs more
   *  than one lane: its operatory columns, plus the DB's exclusion constraint, already
   *  guarantee nothing in one column overlaps. */
  laneIndex?: number;
  laneCount?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: { appointment },
  });

  const startMinutes = minutesOfDay(appointment.starts_at, timeZone);
  const endMinutes = overrideEndMinutes ?? minutesOfDay(appointment.ends_at, timeZone);
  const top = minutesToY(startMinutes, range);
  const height = durationToHeight(startMinutes, endMinutes);

  const style: CSSProperties = {
    top,
    height,
    left: `calc(${(laneIndex / laneCount) * 100}% + 2px)`,
    width: `calc(${100 / laneCount}% - 4px)`,
    borderLeftColor: provider?.color ?? "#33556E",
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : selected ? 5 : 1,
  };

  const startLabel = new Date(appointment.starts_at).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const endLabel = overrideEndMinutes !== undefined ? formatTimeLabel(overrideEndMinutes) : new Date(appointment.ends_at).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      tabIndex={0}
      role="button"
      aria-label={`${patientName}, ${startLabel} to ${endLabel}, ${appointment.status}`}
      onFocus={onSelect}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      style={style}
      className={`absolute flex cursor-grab flex-col overflow-hidden rounded-[var(--radius)] border-l-[3px] bg-surface px-1.5 py-1 text-left shadow-sm outline-none active:cursor-grabbing ${
        selected ? "ring-2 ring-steel" : "ring-1 ring-rule"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[12px] font-medium text-ink">{patientName}</span>
        <StatusPill appointment={appointment} onChanged={onChanged} />
      </div>
      <span className="truncate font-data text-[11px] text-ink-soft">
        {startLabel}–{endLabel}
      </span>
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeStart(e);
        }}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      />
    </div>
  );
}
