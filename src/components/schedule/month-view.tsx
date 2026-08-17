"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { listAppointments, listScheduleBlocks } from "@/lib/schedule-api";
import { monthGridDays, isSameMonth, dayOfMonthLabel, WEEKDAY_LABELS } from "./date-grid";
import { isoToLocalDateString } from "./time-grid";

const EMPTY: never[] = [];

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Read-only density calendar — the conventional "month planner" role in dental PMS: an
 * overview, not a working surface (grilled and confirmed; see the schedule/page.tsx
 * view switcher). Shows how busy each day is and flags whole-clinic closures; clicking
 * a day hands off to the day view, where booking actually happens.
 */
export function MonthView({
  locationId,
  date,
  providerId = null,
  onSelectDay,
}: {
  locationId: string;
  date: string;
  /** null = "All" — every provider's bookings counted together. */
  providerId?: string | null;
  onSelectDay: (date: string) => void;
}) {
  const { user } = useAuth();
  const timeZone = user?.organization.timezone ?? "Asia/Kolkata";

  const days = useMemo(() => monthGridDays(date), [date]);
  const from = days[0];
  const to = days[days.length - 1];

  const appointmentsQuery = useQuery({
    queryKey: ["appointments", locationId, "month", from, to],
    queryFn: () => listAppointments({ location_id: locationId, from, to }),
  });
  const blocksQuery = useQuery({
    queryKey: ["schedule-blocks", locationId, from, to],
    queryFn: () => listScheduleBlocks({ location_id: locationId, from, to }),
  });

  const allAppointments = appointmentsQuery.data?.data ?? EMPTY;
  const blocks = blocksQuery.data?.data ?? EMPTY;
  const appointments = useMemo(
    () => (providerId ? allAppointments.filter((a) => a.provider_id === providerId) : allAppointments),
    [allAppointments, providerId],
  );

  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const appt of appointments) {
      if (appt.status === "cancelled") continue;
      const d = isoToLocalDateString(appt.starts_at, timeZone);
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return map;
  }, [appointments, timeZone]);

  // Whole-clinic closures always count as a holiday marker. When a specific provider
  // is selected, their own leave/block days count too — genuinely useful to see at a
  // glance once you've narrowed to one provider, unlike under "All" where one
  // dentist's day off shouldn't dim the whole month.
  const holidays = useMemo(() => {
    const set = new Set<string>();
    for (const b of blocks) {
      if (b.operatory_id) continue;
      if (b.provider_id && b.provider_id !== providerId) continue;
      set.add(isoToLocalDateString(b.starts_at, timeZone));
    }
    return set;
  }, [blocks, providerId, timeZone]);

  const today = todayStr();
  const loading = appointmentsQuery.isLoading || blocksQuery.isLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-none grid-cols-7 border-b border-rule bg-surface">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="border-l border-rule px-2 py-2 text-center font-condensed text-[11px] font-semibold uppercase tracking-wide text-ink-soft first:border-l-0">
            {label}
          </div>
        ))}
      </div>

      <div className={`grid flex-1 grid-cols-7 ${loading ? "opacity-50" : ""}`} style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const inMonth = isSameMonth(d, date);
          const count = countByDay.get(d) ?? 0;
          const isHoliday = holidays.has(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDay(d)}
              className={`flex flex-col items-start gap-1 border-l border-t border-rule p-2 text-left first:border-l-0 hover:bg-steel-lo ${
                inMonth ? "bg-surface" : "bg-paper"
              }`}
            >
              <span
                className={`font-data text-[12px] ${d === today ? "flex h-5 w-5 items-center justify-center rounded-full bg-steel text-white" : inMonth ? "text-ink" : "text-ink-soft"}`}
              >
                {dayOfMonthLabel(d)}
              </span>
              {isHoliday && (
                <span className="truncate text-[10px] text-ink-soft">
                  {
                    blocks.find(
                      (b) => !b.operatory_id && (!b.provider_id || b.provider_id === providerId) && isoToLocalDateString(b.starts_at, timeZone) === d,
                    )?.reason
                  }
                </span>
              )}
              {count > 0 && (
                <span className="rounded-full bg-steel-lo px-1.5 py-0.5 font-data text-[11px] font-medium text-steel">
                  {count} booked
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
