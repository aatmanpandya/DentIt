/**
 * No date library is installed in this codebase (see existing hand-rolled Date math in
 * fee-schedule/page.tsx and patients/[id]/layout.tsx) — this stays consistent with that
 * rather than pulling in date-fns-tz for one calculation. Organizations carry a real
 * `timezone` column (default "Asia/Kolkata"), so day-boundary math needs to be
 * timezone-aware, not just UTC-midnight — the day view's primary query
 * (`GET /appointments?date=`) would silently misfile appointments near midnight
 * otherwise. Built on Intl, which Node/the browser already ship.
 */
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

/** [start, end) as real UTC instants for one calendar day in `timeZone`. */
export function zonedDayRange(dateStr: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = timeZoneOffsetMs(new Date(naiveUTC), timeZone);
  const start = new Date(naiveUTC - offset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** The day-of-week (0=Sunday) a UTC instant falls on in `timeZone`, matching provider_schedules.day_of_week. */
export function zonedDayOfWeek(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

/** "HH:MM:SS" local clock time for a UTC instant in `timeZone` — same shape postgres.js returns for a `time` column, so it's directly string-comparable against one. */
export function zonedTimeOfDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/** The inverse of zonedTimeOfDay: a "YYYY-MM-DD" date + "HH:MM[:SS]" local clock time in `timeZone`, as a real UTC instant. */
export function zonedDateTimeToInstant(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm, ss] = timeStr.split(":").map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
  const offset = timeZoneOffsetMs(new Date(naiveUTC), timeZone);
  return new Date(naiveUTC - offset);
}
