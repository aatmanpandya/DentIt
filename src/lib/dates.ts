/**
 * "YYYY-MM-DD" for today in the clinic's timezone. `new Date().toISOString().slice(0, 10)` is
 * the UTC date, which is still yesterday between 00:00 and 05:30 IST (docs/bug-log.md entry 27).
 */
export function todayIn(timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
