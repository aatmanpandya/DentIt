"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listLocations, listProviders } from "@/lib/schedule-api";
import { DayView } from "@/components/schedule/day-view";
import { WeekView } from "@/components/schedule/week-view";
import { MonthView } from "@/components/schedule/month-view";
import { shiftWeekStr, shiftMonthStr, weekRangeLabel, monthLabel } from "@/components/schedule/date-grid";

type View = "day" | "week" | "month";

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

function shiftDateStr(date: string, delta: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString("en-CA");
}

// Single-location UI for the pilot — the data model supports multiple locations, but
// the pilot UI shows one. Uses the org's first active location
// rather than offering a switcher.
export default function SchedulePage() {
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(todayStr());
  const [providerId, setProviderId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["locations"], queryFn: listLocations });
  const location = data?.data[0];
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const providers = providersQuery.data?.data ?? [];

  function shiftView(delta: number) {
    if (view === "day") setDate((d) => shiftDateStr(d, delta));
    else if (view === "week") setDate((d) => shiftWeekStr(d, delta));
    else setDate((d) => shiftMonthStr(d, delta));
  }

  function goToday() {
    setDate(todayStr());
  }

  function selectDayFromMonth(d: string) {
    setDate(d);
    setView("day");
  }

  if (isLoading) {
    return <div className="flex-1" aria-hidden />;
  }

  if (!location) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[13px] text-ink">No location set up yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <h1 className="font-condensed text-[13px] font-semibold text-ink">Calendar</h1>

        <div className="flex items-center gap-1">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`h-7 rounded-[var(--radius)] px-3 text-[12px] font-medium capitalize ${
                view === v ? "bg-steel text-white" : "text-ink-soft hover:bg-steel-lo hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {providers.length > 0 && (
          <select
            value={providerId ?? ""}
            onChange={(e) => setProviderId(e.target.value || null)}
            className="h-8 rounded-[var(--radius)] border border-rule bg-paper px-2 text-[13px] text-ink outline-none"
          >
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {view !== "day" && (
            <span className="mr-1 font-data text-[13px] text-ink-soft">
              {view === "week" ? weekRangeLabel(date) : monthLabel(date)}
            </span>
          )}
          <button
            type="button"
            onClick={() => shiftView(-1)}
            aria-label={`Previous ${view}`}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-ink-soft hover:bg-steel-lo hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-8 rounded-[var(--radius)] border border-rule px-3 text-[12px] text-ink hover:bg-steel-lo"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shiftView(1)}
            aria-label={`Next ${view}`}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-ink-soft hover:bg-steel-lo hover:text-ink"
          >
            <ChevronRight size={16} />
          </button>
          {view === "day" && (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 rounded-[var(--radius)] border border-rule bg-paper px-2 font-data text-[13px] text-ink outline-none"
            />
          )}
        </div>
      </div>

      {view === "day" && <DayView locationId={location.id} date={date} providerId={providerId} />}
      {view === "week" && <WeekView locationId={location.id} date={date} providerId={providerId} />}
      {view === "month" && <MonthView locationId={location.id} date={date} providerId={providerId} onSelectDay={selectDayFromMonth} />}
    </div>
  );
}
