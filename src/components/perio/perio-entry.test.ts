import { describe, it, expect } from "vitest";
import { initEntryState, perioEntryReducer, SITE_ORDER, firstIncompleteIndex } from "./perio-entry";
import type { PerioEntryState, EntryAction } from "./perio-entry";

function run(state: PerioEntryState, actions: EntryAction[]) {
  let s = state;
  const allEffects = [];
  for (const a of actions) {
    const { state: next, effects } = perioEntryReducer(s, a);
    s = next;
    allEffects.push(...effects);
  }
  return { state: s, effects: allEffects };
}

const digit = (digit: number): EntryAction => ({ type: "digit", digit });
const dash = (): EntryAction => ({ type: "dash" });
const flag = (f: "bleeding_on_probing" | "suppuration" | "plaque"): EntryAction => ({ type: "flag", flag: f });

describe("perioEntryReducer — single site", () => {
  it("commits pocket depth on a bare digit and advances to gingival margin", () => {
    const { state } = run(initEntryState(["16"]), [digit(4)]);
    expect(state.stage).toBe("gingival_margin");
    expect(state.draft?.sites[0].pocket_depth).toBe(4);
  });

  it("dash then digit gives 10-19mm pocket depth", () => {
    const { state } = run(initEntryState(["16"]), [dash(), digit(2)]);
    expect(state.draft?.sites[0].pocket_depth).toBe(12);
    expect(state.stage).toBe("gingival_margin");
  });

  it("rejects a pocket depth above 15 (dash + 6..9) without advancing", () => {
    const { state, effects } = run(initEntryState(["16"]), [dash(), digit(7)]);
    expect(effects).toContainEqual({ type: "invalid_value" });
    expect(state.stage).toBe("pocket_depth");
    expect(state.draft?.sites[0].pocket_depth).toBeNull();
    expect(state.tensPending).toBe(false); // reset so the next digit isn't misread as tens
  });

  it("bare digit at gingival-margin stage commits positive (recession, the common case — positive per pilot-foundations.md §2)", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), digit(2)]);
    expect(state.draft?.sites[0].gingival_margin).toBe(2);
    expect(state.stage).toBe("flags");
  });

  it("dash then digit at gingival-margin stage commits negative (margin coronal to CEJ, the uncommon case)", () => {
    // Not a modifier key (Ctrl/Cmd+digit is reserved by the browser for tab-switching
    // and never reaches the page — caught live) — same `-`-prefix pattern as pocket depth.
    const { state } = run(initEntryState(["16"]), [digit(3), dash(), digit(4)]);
    expect(state.draft?.sites[0].gingival_margin).toBe(-4);
    expect(state.gmSignPending).toBe(false); // reset after committing
  });

  it("rejects a margin-coronal value beyond -5 (dash + 6-9)", () => {
    const { state, effects } = run(initEntryState(["16"]), [digit(3), dash(), digit(6)]);
    expect(effects).toContainEqual({ type: "invalid_value" });
    expect(state.stage).toBe("gingival_margin");
    expect(state.draft?.sites[0].gingival_margin).toBeNull();
    expect(state.gmSignPending).toBe(false); // reset so the next digit isn't misread as negative
  });

  it("dash then 0 at gingival-margin stage commits plain 0, not -0", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), dash(), digit(0)]);
    expect(state.draft?.sites[0].gingival_margin).toBe(0);
    expect(Object.is(state.draft?.sites[0].gingival_margin, -0)).toBe(false);
  });

  it("gmSignPending from one site never leaks into the next site's pocket depth", () => {
    // Priming "-" for GM's sign, then advancing (without using it) must not silently
    // make the next site's pocket-depth digit look tens-prefixed or vice versa.
    const { state } = run(initEntryState(["16"]), [digit(3), dash(), digit(2), digit(5)]);
    // site 0: PD=3, GM=-2 (dash primed negative), flags stage next
    expect(state.draft?.sites[0]).toMatchObject({ pocket_depth: 3, gingival_margin: -2 });
    // that lone digit(5) reprocesses at site 1's pocket-depth stage as a plain 5, not 15
    expect(state.draft?.sites[1].pocket_depth).toBe(5);
  });

  it("flag keys toggle without advancing the stage", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), digit(0), flag("bleeding_on_probing"), flag("plaque")]);
    expect(state.stage).toBe("flags");
    expect(state.draft?.sites[0].bleeding_on_probing).toBe(true);
    expect(state.draft?.sites[0].plaque).toBe(true);
    expect(state.draft?.sites[0].suppuration).toBe(false);
  });

  it("toggling a flag twice turns it back off", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), digit(0), flag("bleeding_on_probing"), flag("bleeding_on_probing")]);
    expect(state.draft?.sites[0].bleeding_on_probing).toBe(false);
  });
});

describe("perioEntryReducer — advancing between sites and teeth", () => {
  it("a digit at the flags stage advances to the next site and applies as its pocket depth", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), digit(0), digit(5)]);
    expect(state.siteIndex).toBe(1); // "B", the second site
    expect(state.draft?.sites[0].pocket_depth).toBe(3); // MB untouched by the new digit
    expect(state.draft?.sites[1].pocket_depth).toBe(5);
    expect(state.stage).toBe("gingival_margin");
  });

  it("advances with no explicit flag keys — booleans default false, per pilot-foundations.md", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), digit(0), digit(2)]);
    expect(state.draft?.sites[0]).toMatchObject({ bleeding_on_probing: false, suppuration: false, plaque: false });
  });

  it("completing all 6 sites of a tooth fires save_tooth and advances to the next tooth", () => {
    const keys: EntryAction[] = [];
    for (let i = 0; i < SITE_ORDER.length; i++) keys.push(digit(2), digit(0)); // PD=2, GM=0 per site
    keys.push(digit(1)); // tooth 17's first pocket-depth digit — also what triggers 16's save
    const { state, effects } = run(initEntryState(["16", "17"]), keys);

    const saveEffect = effects.find((e) => e.type === "save_tooth");
    expect(saveEffect).toMatchObject({ type: "save_tooth", tooth: "16" });
    if (saveEffect?.type === "save_tooth") {
      expect(saveEffect.sites).toHaveLength(6);
      expect(saveEffect.sites.every((s) => s.pocket_depth === 2 && s.gingival_margin === 0)).toBe(true);
    }

    expect(state.toothIndex).toBe(1);
    expect(state.draft?.tooth).toBe("17");
    expect(state.siteIndex).toBe(0);
    expect(state.stage).toBe("gingival_margin"); // the reprocessed digit already filled 17's first PD
    expect(state.draft?.sites[0].pocket_depth).toBe(1);
  });

  it("finishing the last tooth in the order emits exam_complete and leaves draft null", () => {
    const keys: EntryAction[] = [];
    for (let i = 0; i < SITE_ORDER.length; i++) keys.push(digit(1), digit(0));
    keys.push({ type: "advance" }); // no next digit exists for the very last site of the exam
    const { state, effects } = run(initEntryState(["16"]), keys);

    expect(effects.some((e) => e.type === "exam_complete")).toBe(true);
    expect(state.draft).toBeNull();
    expect(state.toothIndex).toBe(1);
  });

  it("ignores further keystrokes once the exam is complete", () => {
    const keys: EntryAction[] = [];
    for (let i = 0; i < SITE_ORDER.length; i++) keys.push(digit(1), digit(0));
    keys.push({ type: "advance" });
    const { state: finished } = run(initEntryState(["16"]), keys);

    const { state, effects } = perioEntryReducer(finished, digit(5));
    expect(state).toBe(finished);
    expect(effects).toEqual([]);
  });

  it("a dash at the flags stage also advances to the next site (tens-prefix for its pocket depth)", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), digit(0), dash(), digit(0)]);
    expect(state.siteIndex).toBe(1);
    expect(state.draft?.sites[1].pocket_depth).toBe(10);
  });
});

describe("perioEntryReducer — mobility and furcation menu", () => {
  it("opens a menu without disturbing the site cursor", () => {
    const { state } = run(initEntryState(["16"]), [digit(3), { type: "open_menu", menu: "furcation" }]);
    expect(state.menu).toBe("furcation");
    expect(state.stage).toBe("gingival_margin"); // unaffected
  });

  it("selecting a menu value sets the field and closes the menu, without advancing", () => {
    const { state } = run(initEntryState(["16"]), [{ type: "open_menu", menu: "mobility" }, { type: "select_menu_value", value: 2 }]);
    expect(state.menu).toBeNull();
    expect(state.draft?.mobility).toBe(2);
    expect(state.siteIndex).toBe(0);
    expect(state.stage).toBe("pocket_depth");
  });

  it("closes the menu on escape without changing the field", () => {
    const { state } = run(initEntryState(["16"]), [{ type: "open_menu", menu: "furcation" }, { type: "close_menu" }]);
    expect(state.menu).toBeNull();
    expect(state.draft?.furcation).toBeNull();
  });
});

describe("initEntryState", () => {
  it("starts with a null draft for an empty order", () => {
    const state = initEntryState([]);
    expect(state.draft).toBeNull();
    expect(state.toothIndex).toBe(0);
  });

  it("can resume at a given index (returning to a partly-entered exam)", () => {
    const state = initEntryState(["16", "17", "18"], 1);
    expect(state.toothIndex).toBe(1);
    expect(state.draft?.tooth).toBe("17");
  });

  it("clamps a resume index past the end to a finished state", () => {
    const state = initEntryState(["16"], 5);
    expect(state.draft).toBeNull();
    expect(state.toothIndex).toBe(1);
  });
});

describe("firstIncompleteIndex", () => {
  it("finds the first tooth without all 6 sites saved", () => {
    const saved: Record<string, number> = { "16": 6, "17": 3 };
    const index = firstIncompleteIndex(["16", "17", "18"], (t) => saved[t] ?? 0);
    expect(index).toBe(1);
  });

  it("returns the order length when every tooth is complete", () => {
    const index = firstIncompleteIndex(["16", "17"], () => 6);
    expect(index).toBe(2);
  });
});
