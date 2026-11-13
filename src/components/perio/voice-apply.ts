/**
 * Voice perio, stage 4: commands → the cells they change (docs/specs/voice-perio.md).
 *
 * One entry path: every value goes through `perioEntryReducer`, the same reducer the keyboard
 * drives, as the same actions (`jump`, `digit`, `dash`, `flag`, mobility/furcation menu). So the
 * range checks are the keyboard's. Everything is worked out on copies first; if any part of a
 * phrase is out of range or can't be placed, the whole phrase is rejected and nothing changes.
 * Pure, no React: the hook persists what this returns.
 */
import type { VoiceCommand, SiteRef } from "@/lib/voice/grammar";
import { perioEntryReducer, SITE_ORDER, type EntryAction, type PerioEntryState, type PerioSiteCode, type SiteDraft, type ToothDraft } from "./perio-entry";
import type { RouteStep, Side } from "./voice-route";

export interface VoicePosition {
  tooth: string;
  side: Side;
  offset: number; // 0-2: the next site on that side
}

export interface VoiceState {
  cursor: VoicePosition | null; // null: start of the route
  lastSide: { tooth: string; side: Side } | null; // the side recession/flags apply to
  lastDepth: { tooth: string; site: PerioSiteCode } | null; // what "no, make that four" replaces
}

export const INITIAL_VOICE_STATE: VoiceState = { cursor: null, lastSide: null, lastDepth: null };

export interface VoiceContext {
  steps: RouteStep[];
  draftFor: (tooth: string) => ToothDraft; // everything already known for the tooth
  hasFurcation: (tooth: string) => boolean;
}

export interface ToothChange {
  tooth: string;
  before: ToothDraft;
  after: ToothDraft;
}

export type PlanResult =
  | { ok: true; changes: ToothChange[]; skips: string[]; voice: VoiceState; cells: { tooth: string; site: PerioSiteCode | null }[] }
  | { ok: false; reason: string };

class Reject extends Error {}

/** Runs keyboard actions against a one-tooth entry state; throws Reject on an invalid value. */
function runActions(draft: ToothDraft, site: PerioSiteCode, actions: EntryAction[]): ToothDraft {
  let state: PerioEntryState = {
    order: [draft.tooth],
    toothIndex: 0,
    siteIndex: SITE_ORDER.indexOf(site),
    stage: "pocket_depth",
    tensPending: false,
    gmSignPending: false,
    menu: null,
    draft,
  };
  for (const action of actions) {
    const { state: next, effects } = perioEntryReducer(state, action);
    if (effects.some((e) => e.type === "invalid_value")) throw new Reject("out of range");
    state = next;
  }
  return state.draft as ToothDraft;
}

/** The keystrokes for a pocket depth: a digit, or `-` then a digit for 10-15. */
function depthKeys(value: number): EntryAction[] {
  if (!Number.isInteger(value) || value < 0 || value > 15) throw new Reject(`A pocket of ${value} mm is out of range (0–15).`);
  return value >= 10 ? [{ type: "dash" }, { type: "digit", digit: value - 10 }] : [{ type: "digit", digit: value }];
}

function siteOf(draft: ToothDraft, site: PerioSiteCode): SiteDraft {
  return draft.sites.find((s) => s.site === site) as SiteDraft;
}

function resolveSite(step: RouteStep, ref: SiteRef): PerioSiteCode {
  if (ref === "first") return step.sites[0];
  if (ref === "middle") return step.sites[1];
  if (ref === "last") return step.sites[2];
  return step.sites.find((s) => s.startsWith(ref === "mesial" ? "M" : "D")) as PerioSiteCode;
}

export function planPhrase(commands: VoiceCommand[], voice: VoiceState, ctx: VoiceContext): PlanResult {
  const drafts = new Map<string, ToothDraft>();
  const befores = new Map<string, ToothDraft>();
  const cells: { tooth: string; site: PerioSiteCode | null }[] = [];
  const skips: string[] = [];
  let steps = ctx.steps;
  let { cursor, lastSide, lastDepth } = voice;

  const get = (tooth: string) => {
    if (!drafts.has(tooth)) {
      const d = ctx.draftFor(tooth);
      befores.set(tooth, d);
      drafts.set(tooth, d);
    }
    return drafts.get(tooth) as ToothDraft;
  };
  const stepIndex = (tooth: string, side: Side) => steps.findIndex((s) => s.tooth === tooth && s.side === side);
  const stepFor = (pos: { tooth: string; side: Side } | null) => (pos ? steps[stepIndex(pos.tooth, pos.side)] : undefined);

  try {
    for (const cmd of commands) {
      switch (cmd.type) {
        case "depths": {
          let idx = cursor ? stepIndex(cursor.tooth, cursor.side) : 0;
          let offset = cursor?.offset ?? 0;
          if (idx === -1) throw new Reject("The current tooth isn't in the exam any more — say “jump to …”.");
          for (const value of cmd.values) {
            const step = steps[idx];
            if (!step) throw new Reject("That's past the end of the exam.");
            const site = step.sites[offset];
            const draft = get(step.tooth);
            drafts.set(step.tooth, runActions(draft, site, depthKeys(value)));
            cells.push({ tooth: step.tooth, site });
            lastDepth = { tooth: step.tooth, site };
            lastSide = { tooth: step.tooth, side: step.side };
            offset++;
            if (offset === 3) {
              idx++;
              offset = 0;
            }
          }
          const next = steps[idx];
          cursor = next ? { tooth: next.tooth, side: next.side, offset } : { tooth: steps[steps.length - 1].tooth, side: steps[steps.length - 1].side, offset: 3 };
          break;
        }

        case "recession": {
          const step = stepFor(lastSide);
          if (!step) throw new Reject("Say the pocket depths before the recession.");
          let draft = get(step.tooth);
          cmd.values.forEach((value, n) => {
            const site = step.sites[n];
            const pd = siteOf(draft, site).pocket_depth;
            if (pd === null) throw new Reject(`No pocket depth at ${step.tooth} ${site} yet.`);
            if (!Number.isInteger(value) || value < -5 || value > 9) throw new Reject(`Recession ${value} is out of range for voice (−5 to 9).`);
            // Re-enter the same pocket depth to reach the recession stop, then the recession —
            // the keyboard's own path (a `-` first for a margin above the CEJ).
            const gmKeys: EntryAction[] = value < 0 ? [{ type: "dash" }, { type: "digit", digit: -value }] : [{ type: "digit", digit: value }];
            draft = runActions(draft, site, [...depthKeys(pd), ...gmKeys]);
            cells.push({ tooth: step.tooth, site });
          });
          drafts.set(step.tooth, draft);
          break;
        }

        case "flag": {
          const step = stepFor(lastSide);
          if (!step) throw new Reject("Say the pocket depths before bleeding, suppuration or plaque.");
          if (cmd.sites.length === 0) throw new Reject("Which sites? Say “all”, or first, middle, last.");
          let draft = get(step.tooth);
          for (const ref of cmd.sites) {
            const site = resolveSite(step, ref);
            if (!siteOf(draft, site)[cmd.flag]) draft = runActions(draft, site, [{ type: "flag", flag: cmd.flag }]);
            cells.push({ tooth: step.tooth, site });
          }
          drafts.set(step.tooth, draft);
          break;
        }

        case "mobility":
        case "furcation": {
          const tooth = lastSide?.tooth ?? cursor?.tooth ?? steps[0]?.tooth;
          if (!tooth) throw new Reject("No tooth to record that on.");
          if (cmd.type === "furcation" && !ctx.hasFurcation(tooth)) throw new Reject(`Tooth ${tooth} isn't multi-rooted — furcation doesn't apply.`);
          const draft = get(tooth);
          drafts.set(
            tooth,
            runActions(draft, "MB", [
              { type: "open_menu", menu: cmd.type },
              { type: "select_menu_value", value: cmd.value as 0 | 1 | 2 | 3 },
            ]),
          );
          cells.push({ tooth, site: null });
          break;
        }

        case "jump": {
          const side = cmd.side ?? cursor?.side ?? "outside";
          if (stepIndex(cmd.tooth, side) === -1) throw new Reject(`Tooth ${cmd.tooth} isn't being probed in this exam.`);
          cursor = { tooth: cmd.tooth, side, offset: 0 };
          lastSide = { tooth: cmd.tooth, side };
          break;
        }

        case "back": {
          const idx = cursor ? stepIndex(cursor.tooth, cursor.side) : 0;
          const prev = steps[Math.max(0, (cursor && cursor.offset > 0 ? idx : idx - 1))];
          if (!prev) throw new Reject("Already at the start.");
          cursor = { tooth: prev.tooth, side: prev.side, offset: 0 };
          lastSide = { tooth: prev.tooth, side: prev.side };
          break;
        }

        case "missing": {
          if (!steps.some((s) => s.tooth === cmd.tooth)) throw new Reject(`Tooth ${cmd.tooth} isn't being probed in this exam.`);
          skips.push(cmd.tooth);
          const curIdx = cursor ? stepIndex(cursor.tooth, cursor.side) : 0;
          const remaining = steps.filter((s, i) => s.tooth !== cmd.tooth && i >= curIdx);
          steps = steps.filter((s) => s.tooth !== cmd.tooth);
          if (cursor?.tooth === cmd.tooth || !cursor) {
            const next = remaining[0];
            cursor = next ? { tooth: next.tooth, side: next.side, offset: 0 } : null;
          }
          if (lastSide?.tooth === cmd.tooth) lastSide = null;
          cells.push({ tooth: cmd.tooth, site: null });
          break;
        }

        case "correction": {
          if (!lastDepth) throw new Reject("Nothing to correct yet.");
          const { tooth, site } = lastDepth;
          drafts.set(tooth, runActions(get(tooth), site, depthKeys(cmd.value)));
          cells.push({ tooth, site });
          break;
        }

        case "undo":
          throw new Reject("Undo is handled on its own.");
      }
    }
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message === "out of range" ? "A value is out of range." : e.message };
    throw e;
  }

  const changes = [...drafts.entries()]
    .map(([tooth, after]) => ({ tooth, before: befores.get(tooth) as ToothDraft, after }))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
  return { ok: true, changes, skips, voice: { cursor, lastSide, lastDepth }, cells };
}
