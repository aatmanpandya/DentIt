import { describe, it, expect } from "vitest";
import { buildDeltaIndex, badgeForDelta } from "./perio-compare";
import type { PerioSiteDelta } from "@/lib/perio-api";

function delta(overrides: Partial<PerioSiteDelta>): PerioSiteDelta {
  return { tooth: "16", site: "MB", cal_now: null, cal_before: null, delta: null, significant: false, ...overrides };
}

describe("buildDeltaIndex", () => {
  it("keys deltas by tooth:site so the grid can look one up per cell", () => {
    const index = buildDeltaIndex([delta({ tooth: "16", site: "MB", delta: 1 }), delta({ tooth: "16", site: "B", delta: -1 })]);

    expect(index.get("16:MB")?.delta).toBe(1);
    expect(index.get("16:B")?.delta).toBe(-1);
    expect(index.get("16:DB")).toBeUndefined();
  });
});

describe("badgeForDelta", () => {
  it("shows no badge when there's no delta entry for this cell", () => {
    expect(badgeForDelta(undefined)).toBeNull();
  });

  it("shows no badge when the current exam hasn't measured this site yet", () => {
    expect(badgeForDelta(delta({ cal_now: null, cal_before: 3 }))).toBeNull();
  });

  it("labels a site with no prior measurement as new, not significant", () => {
    expect(badgeForDelta(delta({ cal_now: 3, cal_before: null, delta: null }))).toEqual({ label: "new", significant: false });
  });

  it("labels a 2mm-worse CAL as significant with a + sign", () => {
    expect(badgeForDelta(delta({ cal_now: 5, cal_before: 3, delta: 2, significant: true }))).toEqual({ label: "+2", significant: true });
  });

  it("labels a 1mm improvement as not significant with a - sign", () => {
    expect(badgeForDelta(delta({ cal_now: 2, cal_before: 3, delta: -1, significant: false }))).toEqual({ label: "-1", significant: false });
  });

  it("labels an unchanged site as 0, not significant", () => {
    expect(badgeForDelta(delta({ cal_now: 3, cal_before: 3, delta: 0, significant: false }))).toEqual({ label: "0", significant: false });
  });
});
