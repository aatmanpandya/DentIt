import { describe, it, expect } from "vitest";
import { zonedDayRange, zonedDateTimeToInstant, zonedDateString } from "./timezone";

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

describe("zonedDateString", () => {
  it("gives the IST calendar day, not the UTC one, around midnight", () => {
    // 23:59 IST on 12 Nov = 18:29 UTC, 12 Nov; 00:01 IST on 13 Nov = 18:31 UTC, still 12 Nov in UTC.
    expect(zonedDateString(new Date("2026-11-12T18:29:00Z"), "Asia/Kolkata")).toBe("2026-11-12");
    expect(zonedDateString(new Date("2026-11-12T18:31:00Z"), "Asia/Kolkata")).toBe("2026-11-13");
    // New Year: 00:30 IST on 1 Jan 2027 is still 2026 in UTC.
    expect(zonedDateString(new Date("2026-12-31T19:00:00Z"), "Asia/Kolkata")).toBe("2027-01-01");
  });
});
