import { describe, it, expect } from "vitest";
import { buildArchOverlay, splitByArch } from "./perio-overlay-geometry";
import type { PerioToothRecord, PerioSiteMeasurement } from "@/lib/perio-api";

function site(overrides: Partial<PerioSiteMeasurement>): PerioSiteMeasurement {
  return { site: "B", pocket_depth: null, gingival_margin: null, cal: null, bleeding_on_probing: false, suppuration: false, plaque: false, ...overrides };
}

function tooth(overrides: Partial<PerioToothRecord>): PerioToothRecord {
  return { tooth: "16", mobility: null, furcation: null, is_skipped: false, sites: [], ...overrides };
}

describe("buildArchOverlay", () => {
  it("averages PD and CAL across the buccal sites only, ignoring lingual", () => {
    const t = tooth({
      sites: [
        site({ site: "MB", pocket_depth: 3, cal: 3 }),
        site({ site: "B", pocket_depth: 5, cal: 5 }),
        site({ site: "DB", pocket_depth: 4, cal: 4 }),
        site({ site: "ML", pocket_depth: 9, cal: 9 }),
      ],
    });

    const { buccal, lingual } = buildArchOverlay([t]);

    expect(buccal[0]).toEqual({ tooth: "16", pd: 4, cal: 4 });
    expect(lingual[0].pd).toBe(9);
  });

  it("gives a skipped tooth a null gap on both surfaces", () => {
    const t = tooth({ is_skipped: true, sites: [site({ site: "B", pocket_depth: 3, cal: 3 })] });

    const { buccal, lingual } = buildArchOverlay([t]);

    expect(buccal[0]).toEqual({ tooth: "16", pd: null, cal: null });
    expect(lingual[0]).toEqual({ tooth: "16", pd: null, cal: null });
  });

  it("averages only whichever sites are actually saved (not yet fully entered tooth)", () => {
    const t = tooth({ sites: [site({ site: "MB", pocket_depth: 6, cal: 6 })] });

    const { buccal } = buildArchOverlay([t]);

    expect(buccal[0].pd).toBe(6);
  });

  it("leaves a surface null when none of its sites have been saved yet", () => {
    const t = tooth({ sites: [site({ site: "ML", pocket_depth: 2, cal: 2 })] });

    const { buccal } = buildArchOverlay([t]);

    expect(buccal[0]).toEqual({ tooth: "16", pd: null, cal: null });
  });
});

describe("splitByArch", () => {
  it("buckets permanent teeth into upper/lower by anatomical arch", () => {
    const { upper, lower } = splitByArch([tooth({ tooth: "16" }), tooth({ tooth: "46" }), tooth({ tooth: "21" }), tooth({ tooth: "31" })]);

    expect(upper.map((t) => t.tooth)).toEqual(["16", "21"]);
    expect(lower.map((t) => t.tooth)).toEqual(["46", "31"]);
  });

  it("buckets primary teeth into the same arch as their permanent socket (mixed dentition)", () => {
    const { upper, lower } = splitByArch([tooth({ tooth: "55" }), tooth({ tooth: "85" })]);

    expect(upper.map((t) => t.tooth)).toEqual(["55"]);
    expect(lower.map((t) => t.tooth)).toEqual(["85"]);
  });

  it("drops a tooth code that doesn't resolve to a known socket, rather than defaulting it into an arch", () => {
    const { upper, lower } = splitByArch([tooth({ tooth: "99" }), tooth({ tooth: "16" })]);

    expect(upper.map((t) => t.tooth)).toEqual(["16"]);
    expect(lower).toEqual([]);
  });
});
