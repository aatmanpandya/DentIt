import { describe, it, expect } from "vitest";
import { orderTeethForTraversal, DEFAULT_PROBING_SEQUENCE } from "./perio-sequence";
import type { PerioToothRecord } from "@/lib/perio-api";

function tooth(fdi: string): PerioToothRecord {
  return { tooth: fdi, mobility: null, furcation: null, is_skipped: false, sites: [] };
}

describe("orderTeethForTraversal", () => {
  it("orders seeded teeth per the default sequence (upper arch left-to-right, then lower)", () => {
    const teeth = [tooth("21"), tooth("18"), tooth("48")];
    const ordered = orderTeethForTraversal(teeth, null);
    expect(ordered.map((t) => t.tooth)).toEqual(["18", "21", "48"]);
  });

  it("substitutes a primary tooth for its permanent socket position", () => {
    // "51" occupies the same socket as permanent "11" (upper-right central incisor).
    const teeth = [tooth("18"), tooth("51")];
    const ordered = orderTeethForTraversal(teeth, null);
    expect(ordered.map((t) => t.tooth)).toEqual(["18", "51"]);
  });

  it("skips sockets with nothing seeded", () => {
    const teeth = [tooth("18"), tooth("28")];
    const ordered = orderTeethForTraversal(teeth, null);
    expect(ordered).toHaveLength(2);
  });

  it("respects a custom organization sequence over the default", () => {
    const teeth = [tooth("18"), tooth("48")];
    const customSequence = [...DEFAULT_PROBING_SEQUENCE].reverse();
    const ordered = orderTeethForTraversal(teeth, customSequence);
    expect(ordered.map((t) => t.tooth)).toEqual(["48", "18"]);
  });
});
