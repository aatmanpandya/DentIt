/**
 * Pure calendar-arithmetic helpers for the week and month views — operates entirely on
 * "YYYY-MM-DD" strings and the browser's local calendar (same convention already used
 * by schedule/page.tsx's todayStr/shiftDateStr for the day view's date nav), not an
 * org timezone. A calendar date is unambiguous once you have the string; there's no
 * instant to convert.
 */

function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function toDateStr(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

function addDays(dateStr: string, days: number): string {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/** The Sunday on or before `dateStr`. */
export function startOfWeekStr(dateStr: string): string {
  return addDays(dateStr, -toDate(dateStr).getDay());
}

export function shiftWeekStr(dateStr: string, deltaWeeks: number): string {
  return addDays(dateStr, deltaWeeks * 7);
}

/** Seven consecutive dates, Sunday through Saturday, covering the week `dateStr` falls in. */
export function weekGridDays(dateStr: string): string[] {
  const start = startOfWeekStr(dateStr);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function weekRangeLabel(dateStr: string): string {
  const days = weekGridDays(dateStr);
  const start = toDate(days[0]);
  const end = toDate(days[6]);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = sameMonth ? `${start.getDate()}` : `${start.getDate()} ${MONTH_ABBR[start.getMonth()]}`;
  const endLabel = `${end.getDate()} ${MONTH_ABBR[end.getMonth()]} ${end.getFullYear()}`;
  return `${startLabel} – ${endLabel}`;
}

export function startOfMonthStr(dateStr: string): string {
  const d = toDate(dateStr);
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function shiftMonthStr(dateStr: string, deltaMonths: number): string {
  const d = toDate(dateStr);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + deltaMonths, 1));
}

/**
 * Every date cell for a month calendar grid — full Sunday-through-Saturday weeks
 * padded with the trailing days of the prior/next month, so the grid is always a whole
 * number of 7-day rows (5 or 6, depending on where the month falls).
 */
export function monthGridDays(dateStr: string): string[] {
  const monthStart = startOfMonthStr(dateStr);
  const d = toDate(dateStr);
  const monthEnd = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const gridStart = startOfWeekStr(monthStart);
  const gridEnd = addDays(startOfWeekStr(monthEnd), 6);

  const days: string[] = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

export function isSameMonth(dateStr: string, anchorDateStr: string): boolean {
  const a = toDate(dateStr);
  const b = toDate(anchorDateStr);
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

export function monthLabel(dateStr: string): string {
  return toDate(dateStr).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function dayOfMonthLabel(dateStr: string): number {
  return toDate(dateStr).getDate();
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
