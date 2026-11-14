import { describe, it, expect } from "vitest";
import { buildRoute } from "./voice-route";

const ADULT = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28", "31", "32", "33", "34", "35", "36", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48"];

describe("buildRoute", () => {
  it("outside first: outside 18→28, outside 38→48, inside 48→38, inside 28→18", () => {
    const steps = buildRoute("outside_first", ADULT);
    expect(steps).toHaveLength(64);
    const at = (i: number) => `${steps[i].tooth} ${steps[i].side}`;
    expect([at(0), at(15), at(16), at(31), at(32), at(47), at(48), at(63)]).toEqual([
      "18 outside", "28 outside", "38 outside", "48 outside", "48 inside", "38 inside", "28 inside", "18 inside",
    ]);
  });

  it("each jaw first: outside 18→28, inside 28→18, inside 48→38, outside 38→48", () => {
    const steps = buildRoute("each_jaw", ADULT);
    const at = (i: number) => `${steps[i].tooth} ${steps[i].side}`;
    expect([at(16), at(31), at(32), at(48)]).toEqual(["28 inside", "18 inside", "48 inside", "38 outside"]);
  });

  it("reads sites in travel order: distal first toward the midline, mesial first past it", () => {
    const steps = buildRoute("outside_first", ADULT);
    expect(steps[0].sites).toEqual(["DB", "B", "MB"]); // 18, moving toward 11
    expect(steps[8].sites).toEqual(["MB", "B", "DB"]); // 21, moving away from the midline
    expect(steps.find((s) => s.tooth === "48" && s.side === "inside")?.sites).toEqual(["DL", "L", "ML"]);
  });

  it("passes over skipped teeth and puts a primary tooth in its socket's place", () => {
    const steps = buildRoute("outside_first", ["18", "55", "28"]);
    expect(steps.filter((s) => s.side === "outside").map((s) => s.tooth)).toEqual(["18", "55", "28"]);
  });
});

describe("buildRoute: around each tooth (Dr Nimisha's order)", () => {
  // Each tooth all the way round — outside, then on round to the inside — before the next tooth;
  // teeth in order 18→28, then 38→48.
  it("visits every tooth outside then inside before moving on", () => {
    const steps = buildRoute("around_tooth", ADULT);
    expect(steps).toHaveLength(64);
    expect(steps.slice(0, 4).map((s) => `${s.tooth} ${s.side}`)).toEqual(["18 outside", "18 inside", "17 outside", "17 inside"]);
    expect(steps.slice(30, 34).map((s) => `${s.tooth} ${s.side}`)).toEqual(["28 outside", "28 inside", "38 outside", "38 inside"]);
    expect(`${steps[63].tooth} ${steps[63].side}`).toBe("48 inside");
  });

  it("continues round the tooth: the inside starts where the outside ended", () => {
    const steps = buildRoute("around_tooth", ADULT);
    expect(steps[0].sites).toEqual(["DB", "B", "MB"]); // 18 outside, toward the midline
    expect(steps[1].sites).toEqual(["ML", "L", "DL"]); // 18 inside, on round from mesial
    expect(steps.find((s) => s.tooth === "21" && s.side === "outside")?.sites).toEqual(["MB", "B", "DB"]);
    expect(steps.find((s) => s.tooth === "21" && s.side === "inside")?.sites).toEqual(["DL", "L", "ML"]);
  });
});
