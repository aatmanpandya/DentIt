/**
 * Pure time/pixel math for the day and week views — no DOM, no fetch, deliberately
 * independent of React so it's cheap to unit test. Mirrors the day-boundary approach in
 * src/server/lib/timezone.ts (Intl-based, no date library) but duplicated here rather
 * than imported: that module lives under src/server and this runs in the browser.
 */
export const GRID_SNAP_MINUTES = 15;
export const PIXELS_PER_MINUTE = 1.6; // 24px per 15-min row, 96px/hour
export const GRID_START_MINUTES = 8 * 60; // 8:00 AM — fallback when no provider_schedules exist
export const GRID_END_MINUTES = 20 * 60; // 8:00 PM — fallback when no provider_schedules exist

export interface GridRange {
  start: number;
  end: number;
}

export const DEFAULT_GRID_RANGE: GridRange = { start: GRID_START_MINUTES, end: GRID_END_MINUTES };

const GRID_RANGE_PADDING_MINUTES = 60;

/** "HH:MM" or "HH:MM:SS" (the shape postgres.js returns for a `time` column) -> minutes since midnight. */
export function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Derives the grid's displayed time range from a set of provider_schedules rows —
 * padded an hour around the earliest start and latest end, falling back to the fixed
 * 8am-8pm range when there's nothing to derive from (no schedule that day, or the read
 * hasn't resolved yet). Callers pass in whichever rows are relevant to what they're
 * rendering: one day's worth for the day view (aggregated across every visible
 * provider), a whole week's worth for the week view (one provider, every day).
 */
export function computeGridRange(schedules: { startTime: string; endTime: string }[]): GridRange {
  if (schedules.length === 0) return DEFAULT_GRID_RANGE;

  const starts = schedules.map((s) => timeStringToMinutes(s.startTime));
  const ends = schedules.map((s) => timeStringToMinutes(s.endTime));

  return {
    start: snapMinutes(Math.max(0, Math.min(...starts) - GRID_RANGE_PADDING_MINUTES)),
    end: snapMinutes(Math.min(24 * 60, Math.max(...ends) + GRID_RANGE_PADDING_MINUTES)),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** Minutes since local midnight, in `timeZone`, for a UTC ISO instant. */
export function minutesOfDay(iso: string, timeZone: string): number {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(
    date,
  );
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Combines a "YYYY-MM-DD" date, minutes-of-day, and IANA timezone into a UTC ISO instant. */
export function localDateTimeToISO(dateStr: string, minutesOfDayValue: number, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const hh = Math.floor(minutesOfDayValue / 60);
  const mm = minutesOfDayValue % 60;
  const naiveUTC = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = timeZoneOffsetMs(new Date(naiveUTC), timeZone);
  return new Date(naiveUTC - offset).toISOString();
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / GRID_SNAP_MINUTES) * GRID_SNAP_MINUTES;
}

export function minutesToY(minutes: number, range: GridRange = DEFAULT_GRID_RANGE): number {
  return (minutes - range.start) * PIXELS_PER_MINUTE;
}

export function yToMinutes(y: number, range: GridRange = DEFAULT_GRID_RANGE): number {
  return snapMinutes(range.start + y / PIXELS_PER_MINUTE);
}

export function durationToHeight(startMinutes: number, endMinutes: number): number {
  return Math.max(endMinutes - startMinutes, GRID_SNAP_MINUTES) * PIXELS_PER_MINUTE;
}

export function formatTimeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Hour marks (minutes-of-day) for the row labels and gridlines, across a given range. */
export function gridHours(range: GridRange = DEFAULT_GRID_RANGE): number[] {
  return Array.from({ length: Math.floor((range.end - range.start) / 60) + 1 }, (_, i) => range.start + i * 60);
}

export function gridHeightPx(range: GridRange = DEFAULT_GRID_RANGE): number {
  return (range.end - range.start) * PIXELS_PER_MINUTE;
}

export const GRID_HOURS = gridHours();
export const GRID_HEIGHT_PX = gridHeightPx();

/** UTC ISO instant -> "YYYY-MM-DD" calendar date in `timeZone`. */
export function isoToLocalDateString(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Day of week (0=Sunday) for a "YYYY-MM-DD" calendar date — no instant/timezone involved, just calendar arithmetic. */
export function dayOfWeekOfDateStr(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

export interface OverlapLayout {
  lane: number;
  laneCount: number;
}

/**
 * Side-by-side layout for appointments that overlap in time within the same column —
 * the day view never needs this (its operatory columns, plus the DB's exclusion
 * constraint, guarantee no two appointments in one column overlap), but the week
 * view's day columns have no operatory sub-division. A provider can legitimately be
 * double-booked across operatories at the same time (APPOINTMENT_PROVIDER_CONFLICT is
 * a warn-with-override, not a hard block), so the week view needs to render that
 * without the blocks fully covering each other.
 *
 * Classic greedy interval layout: sort by start time, assign each item to the first
 * lane whose occupant has already ended, and once a run of mutually-connected
 * overlapping items closes out, give every item in it that cluster's lane count.
 */
export function layoutOverlaps<T extends { id: string; startMinutes: number; endMinutes: number }>(
  items: T[],
): Map<string, OverlapLayout> {
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  const clusters: T[][] = [];
  let currentCluster: T[] = [];
  let clusterEnd = -Infinity;

  for (const item of sorted) {
    if (currentCluster.length > 0 && item.startMinutes >= clusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      laneEnds.length = 0;
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinutes);
    } else {
      laneEnds[lane] = item.endMinutes;
    }
    laneOf.set(item.id, lane);
    currentCluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const result = new Map<string, OverlapLayout>();
  for (const cluster of clusters) {
    const laneCount = Math.max(...cluster.map((m) => laneOf.get(m.id)!)) + 1;
    for (const m of cluster) {
      result.set(m.id, { lane: laneOf.get(m.id)!, laneCount });
    }
  }
  return result;
}
