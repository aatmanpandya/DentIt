import { CalendarPlus } from "lucide-react";

// Empty-state per docs/specs/validation-and-errors.md: an invitation to act, not an
// apology. Scheduling (day view) lands here on day 7-10 per the pilot schedule.
export default function TodayPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius)] border border-rule bg-surface text-ink-soft">
        <CalendarPlus size={22} strokeWidth={1.5} />
      </div>
      <p className="text-[13px] text-ink">Nothing booked for today yet.</p>
      <p className="max-w-xs text-[12px] text-ink-soft">
        The day view lands here shortly — operatory columns, drag to reschedule.
      </p>
    </div>
  );
}
