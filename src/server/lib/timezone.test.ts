import { describe, it, expect } from "vitest";
import { zonedDayRange, zonedDateTimeToInstant } from "./timezone";

describe("zonedDayRange", () => {
  it("returns UTC instants bracketing a calendar day in Asia/Kolkata (+05:30, no DST)", () => {
    const { start, end } = zonedDayRange("2026-08-19", "Asia/Kolkata");

    // 2026-08-19 00:00 IST == 2026-08-18 18:30 UTC
    expect(start.toISOString()).toBe("2026-08-18T18:30:00.000Z");
    // 2026-08-20 00:00 IST == 2026-08-19 18:30 UTC
    expect(end.toISOString()).toBe("2026-08-19T18:30:00.000Z");
  });

  it("returns exactly 24 hours regardless of timezone", () => {
    const { start, end } = zonedDayRange("2026-01-01", "UTC");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("zonedDateTimeToInstant", () => {
  it("is the inverse of zonedTimeOfDay/zonedDayRange for a date + local clock time in Asia/Kolkata", () => {
    // 2026-08-19 09:00 IST == 2026-08-19 03:30 UTC
    const instant = zonedDateTimeToInstant("2026-08-19", "09:00:00", "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-08-19T03:30:00.000Z");
  });

  it("accepts a bare HH:MM time (as postgres.js `time` columns sometimes surface)", () => {
    const instant = zonedDateTimeToInstant("2026-08-19", "09:00", "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-08-19T03:30:00.000Z");
  });
});
