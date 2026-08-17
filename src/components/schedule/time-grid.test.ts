import { describe, it, expect } from "vitest";
import {
  minutesOfDay,
  localDateTimeToISO,
  snapMinutes,
  minutesToY,
  yToMinutes,
  formatTimeLabel,
  durationToHeight,
  timeStringToMinutes,
  computeGridRange,
  gridHours,
  gridHeightPx,
  isoToLocalDateString,
  dayOfWeekOfDateStr,
  layoutOverlaps,
  GRID_SNAP_MINUTES,
  DEFAULT_GRID_RANGE,
} from "./time-grid";

describe("minutesOfDay / localDateTimeToISO", () => {
  it("round-trips through Asia/Kolkata (+05:30)", () => {
    const iso = localDateTimeToISO("2026-08-19", 10 * 60 + 30, "Asia/Kolkata"); // 10:30 AM IST
    expect(iso).toBe("2026-08-19T05:00:00.000Z");
    expect(minutesOfDay(iso, "Asia/Kolkata")).toBe(10 * 60 + 30);
  });
});

describe("snapMinutes", () => {
  it("snaps to the nearest 15-minute increment", () => {
    expect(snapMinutes(607)).toBe(600); // 10:07 -> 10:00
    expect(snapMinutes(608)).toBe(615); // 10:08 -> 10:15
  });
});

describe("minutesToY / yToMinutes", () => {
  it("round-trips a snapped time through pixel space", () => {
    const minutes = 10 * 60; // 10:00 AM, inside the grid's 8am-8pm range
    const y = minutesToY(minutes);
    expect(yToMinutes(y)).toBe(minutes);
  });

  it("snaps an arbitrary pixel offset back to the grid", () => {
    const y = minutesToY(10 * 60) + 3; // a few px off a clean snap point
    expect(yToMinutes(y) % GRID_SNAP_MINUTES).toBe(0);
  });
});

describe("durationToHeight", () => {
  it("never renders shorter than one grid row, even for a zero-length range", () => {
    expect(durationToHeight(600, 600)).toBeGreaterThan(0);
  });
});

describe("formatTimeLabel", () => {
  it("formats on-the-hour and mid-hour times", () => {
    expect(formatTimeLabel(9 * 60)).toBe("9 AM");
    expect(formatTimeLabel(13 * 60 + 30)).toBe("1:30 PM");
    expect(formatTimeLabel(0)).toBe("12 AM");
  });
});

describe("timeStringToMinutes", () => {
  it("parses HH:MM and HH:MM:SS the same way", () => {
    expect(timeStringToMinutes("09:30")).toBe(9 * 60 + 30);
    expect(timeStringToMinutes("09:30:00")).toBe(9 * 60 + 30);
  });
});

describe("computeGridRange", () => {
  it("falls back to the fixed 8am-8pm range when there are no schedules", () => {
    expect(computeGridRange([])).toEqual(DEFAULT_GRID_RANGE);
  });

  it("pads an hour around the earliest start and latest end across all rows", () => {
    const range = computeGridRange([
      { startTime: "09:00", endTime: "17:00" },
      { startTime: "10:00", endTime: "18:30" },
    ]);
    expect(range).toEqual({ start: 8 * 60, end: 19 * 60 + 30 });
  });

  it("clamps to a real day — padding never pushes past midnight in either direction", () => {
    const range = computeGridRange([{ startTime: "00:15", endTime: "23:45" }]);
    expect(range.start).toBe(0);
    expect(range.end).toBe(24 * 60);
  });
});

describe("gridHours / gridHeightPx", () => {
  it("matches the default constants when called with no range", () => {
    expect(gridHours()).toEqual(gridHours(DEFAULT_GRID_RANGE));
    expect(gridHeightPx()).toBe(gridHeightPx(DEFAULT_GRID_RANGE));
  });

  it("produces one hour mark per hour in the range, inclusive of both ends", () => {
    expect(gridHours({ start: 9 * 60, end: 12 * 60 })).toEqual([9 * 60, 10 * 60, 11 * 60, 12 * 60]);
  });
});

describe("isoToLocalDateString", () => {
  it("returns the calendar date in the given timezone, not UTC", () => {
    // 2026-08-19T23:00:00+05:30 is already 2026-08-19T17:30:00Z — same UTC day here,
    // but just after IST midnight it would differ; this exercises the IST-forward case.
    expect(isoToLocalDateString("2026-08-19T20:00:00.000Z", "Asia/Kolkata")).toBe("2026-08-20");
    expect(isoToLocalDateString("2026-08-19T20:00:00.000Z", "UTC")).toBe("2026-08-19");
  });
});

describe("dayOfWeekOfDateStr", () => {
  it("returns 0 for a Sunday and 3 for a Wednesday", () => {
    expect(dayOfWeekOfDateStr("2026-08-16")).toBe(0);
    expect(dayOfWeekOfDateStr("2026-08-19")).toBe(3);
  });
});

describe("layoutOverlaps", () => {
  it("gives every item lane 0 and laneCount 1 when nothing overlaps", () => {
    const layout = layoutOverlaps([
      { id: "a", startMinutes: 540, endMinutes: 570 },
      { id: "b", startMinutes: 600, endMinutes: 630 },
    ]);
    expect(layout.get("a")).toEqual({ lane: 0, laneCount: 1 });
    expect(layout.get("b")).toEqual({ lane: 0, laneCount: 1 });
  });

  it("splits two overlapping items into two lanes — the real 'provider double-booked across operatories' case", () => {
    // Mirrors the demo data: a long appointment (9:15-12:20) and a short one fully
    // inside it (9:15-9:45), same provider, different operatories.
    const layout = layoutOverlaps([
      { id: "long", startMinutes: 555, endMinutes: 740 },
      { id: "short", startMinutes: 555, endMinutes: 585 },
    ]);
    expect(layout.get("long")!.laneCount).toBe(2);
    expect(layout.get("short")!.laneCount).toBe(2);
    expect(layout.get("long")!.lane).not.toBe(layout.get("short")!.lane);
  });

  it("reuses a lane once its occupant has ended, rather than growing lanes forever", () => {
    const layout = layoutOverlaps([
      { id: "a", startMinutes: 0, endMinutes: 30 },
      { id: "b", startMinutes: 0, endMinutes: 60 },
      { id: "c", startMinutes: 30, endMinutes: 60 }, // starts exactly when "a" ends — reuses its lane
    ]);
    expect(layout.get("a")!.lane).toBe(layout.get("c")!.lane);
    expect(layout.get("b")!.lane).not.toBe(layout.get("a")!.lane);
    expect(layout.get("a")!.laneCount).toBe(2);
  });

  it("keeps unrelated clusters independent — a laneCount-3 cluster doesn't inflate a separate 1-item cluster", () => {
    const layout = layoutOverlaps([
      { id: "a", startMinutes: 0, endMinutes: 30 },
      { id: "b", startMinutes: 0, endMinutes: 30 },
      { id: "c", startMinutes: 0, endMinutes: 30 },
      { id: "solo", startMinutes: 100, endMinutes: 130 },
    ]);
    expect(layout.get("a")!.laneCount).toBe(3);
    expect(layout.get("solo")).toEqual({ lane: 0, laneCount: 1 });
  });
});
