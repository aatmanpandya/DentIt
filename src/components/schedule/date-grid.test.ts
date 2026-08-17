import { describe, it, expect } from "vitest";
import {
  startOfWeekStr,
  shiftWeekStr,
  weekGridDays,
  weekRangeLabel,
  startOfMonthStr,
  shiftMonthStr,
  monthGridDays,
  isSameMonth,
  monthLabel,
  dayOfMonthLabel,
} from "./date-grid";

describe("startOfWeekStr / weekGridDays", () => {
  it("finds the Sunday on or before a mid-week date", () => {
    // 2026-08-19 is a Wednesday.
    expect(startOfWeekStr("2026-08-19")).toBe("2026-08-16");
  });

  it("returns the date itself when it's already a Sunday", () => {
    expect(startOfWeekStr("2026-08-16")).toBe("2026-08-16");
  });

  it("returns seven consecutive dates starting Sunday", () => {
    expect(weekGridDays("2026-08-19")).toEqual([
      "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    expect(weekGridDays("2026-08-31")).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
    ]);
  });
});

describe("shiftWeekStr", () => {
  it("moves forward and backward by whole weeks", () => {
    expect(shiftWeekStr("2026-08-19", 1)).toBe("2026-08-26");
    expect(shiftWeekStr("2026-08-19", -1)).toBe("2026-08-12");
  });
});

describe("weekRangeLabel", () => {
  it("formats a same-month week without repeating the month", () => {
    expect(weekRangeLabel("2026-08-19")).toBe("16 – 22 Aug 2026");
  });

  it("shows both months when the week spans a month boundary", () => {
    expect(weekRangeLabel("2026-08-31")).toBe("30 Aug – 5 Sep 2026");
  });
});

describe("startOfMonthStr / shiftMonthStr", () => {
  it("finds the first of the month", () => {
    expect(startOfMonthStr("2026-08-19")).toBe("2026-08-01");
  });

  it("shifts by whole months, including across a year boundary", () => {
    expect(shiftMonthStr("2026-08-19", 1)).toBe("2026-09-01");
    expect(shiftMonthStr("2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("monthGridDays", () => {
  it("covers the whole month padded to full Sunday-Saturday weeks", () => {
    const days = monthGridDays("2026-08-19");
    expect(days.length % 7).toBe(0);
    expect(days[0]).toBe("2026-07-26"); // Aug 1 2026 is a Saturday; grid starts the Sunday before
    expect(days.every((d, i) => i === 0 || d > days[i - 1])).toBe(true);
    expect(days).toContain("2026-08-01");
    expect(days).toContain("2026-08-31");
  });
});

describe("isSameMonth", () => {
  it("compares month and year, ignoring day", () => {
    expect(isSameMonth("2026-08-02", "2026-08-19")).toBe(true);
    expect(isSameMonth("2026-09-01", "2026-08-19")).toBe(false);
  });
});

describe("monthLabel / dayOfMonthLabel", () => {
  it("formats a human month label", () => {
    expect(monthLabel("2026-08-19")).toBe("August 2026");
  });

  it("extracts the day-of-month number", () => {
    expect(dayOfMonthLabel("2026-08-19")).toBe(19);
  });
});
