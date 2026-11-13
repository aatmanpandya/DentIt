/**
 * Pure, DOM-free keystroke entry state machine for the perio grid — no React dependency,
 * same pattern as src/components/chart/tooth-grid.ts. This is the "single most important
 * interaction detail" per docs/specs/pilot-foundations.md §2, decided in full in
 * docs/specs/perio.md: bare-digit commit with no Enter, a `-`-prefix for 10-19mm pocket
 * depth, and (originally) Ctrl+digit for a negative gingival margin — replaced with a
 * second `-`-prefix use after live testing found Ctrl/Cmd+digit is unusable: browsers
 * reserve Ctrl+1-9 (Cmd+1-9 on Mac) for tab-switching at the chrome level, so the
 * keydown never reaches the page at all. `-` at the gingival-margin step now primes the
 * next digit as negative, the same "prefix extends the plain digit's meaning" pattern
 * already used for pocket depth (bare digit is positive/recession, the common case —
 * see pilot-foundations.md §2). A 3-stop per-site chain (PD -> GM ->
 * flags), and advance is per TOOTH — the cursor only moves to the next tooth once every
 * site (and the flags stop) has been passed.
 *
 * Skip-toggling is deliberately NOT handled here — it's a standalone action (mouse click
 * or keypress on a tooth's column header, on any tooth, not just the current one) that the
 * component layer performs directly against the API and then re-derives the active
 * (non-skipped) traversal order for. This reducer only ever advances linearly through
 * whatever tooth order it's given.
 */

export const SITE_ORDER = ["MB", "B", "DB", "ML", "L", "DL"] as const;
export type PerioSiteCode = (typeof SITE_ORDER)[number];

export type EntryStage = "pocket_depth" | "gingival_margin" | "flags";
export type MenuKind = "mobility" | "furcation" | null;

export interface SiteDraft {
  site: PerioSiteCode;
  pocket_depth: number | null;
  gingival_margin: number | null;
  bleeding_on_probing: boolean;
  suppuration: boolean;
  plaque: boolean;
}

export interface ToothDraft {
  tooth: string;
  mobility: number | null;
  furcation: number | null;
  sites: SiteDraft[];
}

export interface PerioEntryState {
  order: string[]; // active (non-skipped) tooth FDI codes, in traversal order
  toothIndex: number; // index into `order`; === order.length once the exam is fully entered
  siteIndex: number; // 0-5, index into SITE_ORDER
  stage: EntryStage;
  tensPending: boolean; // true right after a lone `-` keypress at the PD step, awaiting the tens digit
  gmSignPending: boolean; // true right after a lone `-` keypress at the GM step, awaiting the (negative) digit
  menu: MenuKind;
  draft: ToothDraft | null; // null once toothIndex === order.length
}

export type EntryEffect =
  | { type: "save_tooth"; tooth: string; mobility: number | null; furcation: number | null; sites: SiteDraft[] }
  | { type: "invalid_value" }
  | { type: "exam_complete" };

/**
 * A click-to-position target — mouse parity for entry (pilot-foundations.md §2: "any
 * cell is directly clickable"). The reducer itself has no access to already-saved data,
 * so the caller (use-perio-entry.ts, which does) builds the draft to jump into —
 * loaded from whatever's already known for that tooth, never a blank slate, so clicking
 * an already-measured cell can't wipe it.
 */
export interface JumpTarget {
  toothIndex: number; // this tooth's position in `order`
  site: PerioSiteCode;
  draft: ToothDraft;
}

export type EntryAction =
  | { type: "digit"; digit: number }
  | { type: "dash" }
  | { type: "flag"; flag: "bleeding_on_probing" | "suppuration" | "plaque" }
  | { type: "advance" }
  | { type: "jump"; target: JumpTarget }
  | { type: "open_menu"; menu: "mobility" | "furcation" }
  | { type: "select_menu_value"; value: 0 | 1 | 2 | 3 }
  | { type: "close_menu" };

/**
 * What a per-tooth save sends. Mobility and furcation are left out unless set: a draft starts
 * them as null, and sending that null told the server to clear them, so finishing a resumed or
 * revisited tooth wiped its saved mobility (docs/bug-log.md entry 36). The menu only offers
 * 0-3, so null always means "not touched", never "clear". Only sites with a pocket depth go.
 */
export function toothSavePayload(draft: Pick<ToothDraft, "mobility" | "furcation" | "sites">) {
  return {
    ...(draft.mobility !== null ? { mobility: draft.mobility } : {}),
    ...(draft.furcation !== null ? { furcation: draft.furcation } : {}),
    sites: draft.sites.filter((s): s is SiteDraft & { pocket_depth: number } => s.pocket_depth !== null),
  };
}

/** Finds where to resume: the first tooth in `order` that doesn't yet have all 6 sites
 * saved. `sitesByTooth` need only report how many sites are saved for a given tooth. */
export function firstIncompleteIndex(order: string[], sitesByTooth: (tooth: string) => number): number {
  for (let i = 0; i < order.length; i++) {
    if (sitesByTooth(order[i]) < SITE_ORDER.length) return i;
  }
  return order.length;
}

function emptySite(site: PerioSiteCode): SiteDraft {
  return { site, pocket_depth: null, gingival_margin: null, bleeding_on_probing: false, suppuration: false, plaque: false };
}

function freshDraft(tooth: string): ToothDraft {
  return { tooth, mobility: null, furcation: null, sites: SITE_ORDER.map(emptySite) };
}

/** `startIndex` resumes an exam already partly entered in an earlier session — see
 * use-perio-entry.ts's firstIncompleteIndex. Defaults to starting at the beginning. */
export function initEntryState(order: string[], startIndex = 0): PerioEntryState {
  const toothIndex = Math.min(startIndex, order.length);
  return {
    order,
    toothIndex,
    siteIndex: 0,
    stage: "pocket_depth",
    tensPending: false,
    gmSignPending: false,
    menu: null,
    draft: toothIndex < order.length ? freshDraft(order[toothIndex]) : null,
  };
}

interface StepResult {
  state: PerioEntryState;
  effects: EntryEffect[];
}

/** Finalizes the current tooth's draft and moves the cursor to the next one. */
function advanceTooth(state: PerioEntryState): { state: PerioEntryState; effect: EntryEffect } {
  const draft = state.draft as ToothDraft;
  const saveEffect: EntryEffect = { type: "save_tooth", tooth: draft.tooth, mobility: draft.mobility, furcation: draft.furcation, sites: draft.sites };

  const nextIndex = state.toothIndex + 1;
  const done = nextIndex >= state.order.length;

  return {
    state: {
      ...state,
      toothIndex: nextIndex,
      siteIndex: 0,
      stage: "pocket_depth",
      tensPending: false,
      gmSignPending: false,
      menu: null,
      draft: done ? null : freshDraft(state.order[nextIndex]),
    },
    effect: saveEffect,
  };
}

/** Finalizes the current site and moves the cursor to the next one (or the next tooth). */
function advanceSite(state: PerioEntryState): StepResult {
  if (state.siteIndex + 1 < SITE_ORDER.length) {
    return {
      state: { ...state, siteIndex: state.siteIndex + 1, stage: "pocket_depth", tensPending: false, gmSignPending: false },
      effects: [],
    };
  }
  const { state: next, effect } = advanceTooth(state);
  const effects: EntryEffect[] = [effect];
  if (next.draft === null) effects.push({ type: "exam_complete" });
  return { state: next, effects };
}

function withCurrentSite(state: PerioEntryState, patch: Partial<SiteDraft>): PerioEntryState {
  const draft = state.draft as ToothDraft;
  const sites = draft.sites.map((s, i) => (i === state.siteIndex ? { ...s, ...patch } : s));
  return { ...state, draft: { ...draft, sites } };
}

function reduceDigit(state: PerioEntryState, digit: number): StepResult {
  if (state.stage === "flags") {
    // Any digit here means "nothing more for this site" — advance, then re-apply the
    // same digit against the new current site's pocket-depth stage.
    const { state: advanced, effects } = advanceSite(state);
    if (advanced.draft === null) return { state: advanced, effects }; // exam finished; nothing left to apply the digit to
    const rest = reduceDigit(advanced, digit);
    return { state: rest.state, effects: [...effects, ...rest.effects] };
  }

  if (state.stage === "pocket_depth") {
    const value = state.tensPending ? 10 + digit : digit;
    if (value < 0 || value > 15) return { state: { ...state, tensPending: false }, effects: [{ type: "invalid_value" }] };

    const next = withCurrentSite({ ...state, tensPending: false, stage: "gingival_margin" }, { pocket_depth: value });
    return { state: next, effects: [] };
  }

  // gingival_margin — schema convention: POSITIVE = recession, margin apical to CEJ
  // (pilot-foundations.md §2, "never change it"). Recession is the common clinical
  // case, so the easy bare-digit keystroke maps to it; a `-` prefix (like pocket
  // depth's tens-prefix) flags the next digit as the less-common margin-coronal-to-CEJ
  // case, entered as negative. Not a modifier key — see this file's header comment for
  // why Ctrl/Cmd+digit doesn't work in a real browser.
  const value = state.gmSignPending ? (digit === 0 ? 0 : -digit) : digit;
  if (value < -5 || value > 10) return { state: { ...state, gmSignPending: false }, effects: [{ type: "invalid_value" }] };

  const next = withCurrentSite({ ...state, gmSignPending: false, stage: "flags" }, { gingival_margin: value });
  return { state: next, effects: [] };
}

function reduceDash(state: PerioEntryState): StepResult {
  if (state.stage === "flags") {
    const { state: advanced, effects } = advanceSite(state);
    if (advanced.draft === null) return { state: advanced, effects };
    const rest = reduceDash(advanced);
    return { state: rest.state, effects: [...effects, ...rest.effects] };
  }
  if (state.stage === "pocket_depth") return { state: { ...state, tensPending: true }, effects: [] };
  if (state.stage === "gingival_margin") return { state: { ...state, gmSignPending: true }, effects: [] };
  return { state, effects: [] };
}

function reduceFlag(state: PerioEntryState, flag: "bleeding_on_probing" | "suppuration" | "plaque"): StepResult {
  if (state.draft === null) return { state, effects: [] };
  const site = state.draft.sites[state.siteIndex];
  const next = withCurrentSite(state, { [flag]: !site[flag] } as Partial<SiteDraft>);
  return { state: next, effects: [] };
}

export function perioEntryReducer(state: PerioEntryState, action: EntryAction): StepResult {
  // "jump" is allowed even once the exam is fully entered (draft === null) — clicking
  // back onto an already-measured tooth to correct something must still work.
  if (state.draft === null && action.type !== "close_menu" && action.type !== "jump") return { state, effects: [] };

  switch (action.type) {
    case "digit":
      return reduceDigit(state, action.digit);
    case "dash":
      return reduceDash(state);
    case "flag":
      return reduceFlag(state, action.flag);
    case "advance":
      // Explicit "move past the flags stop" — the UI's fallback for the one case the
      // digit-reprocessing trick can't cover: the very last site of the very last tooth
      // in the exam has no next keystroke to reprocess. Also available any time the
      // operator wants to move on without waiting for the next site's first digit.
      return state.stage === "flags" ? advanceSite(state) : { state, effects: [] };
    case "jump":
      return {
        state: {
          ...state,
          toothIndex: action.target.toothIndex,
          siteIndex: SITE_ORDER.indexOf(action.target.site),
          stage: "pocket_depth",
          tensPending: false,
          gmSignPending: false,
          menu: null,
          draft: action.target.draft,
        },
        effects: [],
      };
    case "open_menu":
      return { state: { ...state, menu: action.menu }, effects: [] };
    case "select_menu_value": {
      const draft = state.draft as ToothDraft;
      const patch = state.menu === "mobility" ? { mobility: action.value } : { furcation: action.value };
      return { state: { ...state, menu: null, draft: { ...draft, ...patch } }, effects: [] };
    }
    case "close_menu":
      return { state: { ...state, menu: null }, effects: [] };
  }
}
