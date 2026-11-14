import { describe, it, expect } from "vitest";
import { parse, type VoiceCommand } from "@/lib/voice/grammar";
import { planPhrase, INITIAL_VOICE_STATE, type VoiceContext, type VoiceState } from "./voice-apply";
import { buildRoute } from "./voice-route";
import { SITE_ORDER, type ToothDraft } from "./perio-entry";
import { hasFurcation } from "@/server/lib/tooth-notation";

const TEETH = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28", "31", "32", "33", "34", "35", "36", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48"];
const blank = (tooth: string): ToothDraft => ({
  tooth,
  mobility: null,
  furcation: null,
  sites: SITE_ORDER.map((site) => ({ site, pocket_depth: null, gingival_margin: null, bleeding_on_probing: false, suppuration: false, plaque: false })),
});
const ctx = (known: Record<string, ToothDraft> = {}): VoiceContext => ({
  steps: buildRoute("outside_first", TEETH),
  draftFor: (t) => known[t] ?? blank(t),
  hasFurcation,
});
const cmds = (text: string): VoiceCommand[] => {
  const r = parse(text);
  if (!r.ok) throw new Error(r.reason);
  return r.commands;
};
const site = (d: ToothDraft, s: string) => d.sites.find((x) => x.site === s);

describe("planPhrase", () => {
  it("fills the first side of the route in travel order and moves to the next tooth", () => {
    const r = planPhrase(cmds("323"), INITIAL_VOICE_STATE, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t18 = r.changes[0].after;
    expect([site(t18, "DB")?.pocket_depth, site(t18, "B")?.pocket_depth, site(t18, "MB")?.pocket_depth]).toEqual([3, 2, 3]);
    expect(r.voice.cursor).toEqual({ tooth: "17", side: "outside", offset: 0 });
  });

  it("spans teeth: six numbers fill 18 and 17 outside", () => {
    const r = planPhrase(cmds("232323"), INITIAL_VOICE_STATE, ctx());
    expect(r.ok && r.changes.map((c) => c.tooth)).toEqual(["18", "17"]);
  });

  it("writes 10-15 through the keyboard's tens prefix", () => {
    const r = planPhrase(cmds("3 deep 12 4"), INITIAL_VOICE_STATE, ctx());
    expect(r.ok && site(r.changes[0].after, "B")?.pocket_depth).toBe(12);
  });

  it("applies recession and flags to the side just entered", () => {
    const r = planPhrase(cmds("323 recession 1 0 -1 bleeding first"), INITIAL_VOICE_STATE, ctx());
    if (!r.ok) throw new Error(r.reason);
    const t18 = r.changes[0].after;
    expect([site(t18, "DB")?.gingival_margin, site(t18, "B")?.gingival_margin, site(t18, "MB")?.gingival_margin]).toEqual([1, 0, -1]);
    expect(site(t18, "DB")?.bleeding_on_probing).toBe(true);
    expect(site(t18, "MB")?.bleeding_on_probing).toBe(false);
  });

  it("sets a flag that's already set without toggling it off", () => {
    const known = blank("18");
    known.sites = known.sites.map((s) => (s.site === "DB" ? { ...s, pocket_depth: 3, bleeding_on_probing: true } : s));
    const voice: VoiceState = { cursor: { tooth: "17", side: "outside", offset: 0 }, lastSide: { tooth: "18", side: "outside" }, lastDepth: null };
    const r = planPhrase(cmds("bleeding first"), voice, ctx({ "18": known }));
    expect(r.ok && r.changes).toEqual([]); // nothing changed, still bleeding
  });

  it("puts mobility on the tooth just probed, and refuses furcation on a single-rooted tooth", () => {
    const after323 = planPhrase(cmds("323"), INITIAL_VOICE_STATE, ctx());
    if (!after323.ok) throw new Error();
    const r = planPhrase(cmds("mobility 2"), after323.voice, ctx());
    expect(r.ok && r.changes[0]).toMatchObject({ tooth: "18", after: { mobility: 2 } });
    const front = planPhrase(cmds("jump to 11 outside 323 furcation grade 1"), INITIAL_VOICE_STATE, ctx());
    expect(front).toMatchObject({ ok: false, reason: expect.stringContaining("isn't multi-rooted") });
  });

  it("corrects the last depth", () => {
    const first = planPhrase(cmds("323"), INITIAL_VOICE_STATE, ctx());
    if (!first.ok) throw new Error();
    const known = { "18": first.changes[0].after };
    const r = planPhrase(cmds("no make that 4"), first.voice, ctx(known));
    expect(r.ok && site(r.changes[0].after, "MB")?.pocket_depth).toBe(4);
  });

  it("skips a missing tooth and the route passes it", () => {
    const r = planPhrase(cmds("18 is missing 323"), INITIAL_VOICE_STATE, ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.skips).toEqual(["18"]);
    expect(r.changes.map((c) => c.tooth)).toEqual(["17"]);
  });

  it("rejects the whole phrase when any part fails, and changes nothing", () => {
    expect(planPhrase(cmds("recession 1 0 1"), INITIAL_VOICE_STATE, ctx())).toMatchObject({ ok: false });
    expect(planPhrase(cmds("jump to 18 inside 323 jump to 38 outside recession 1 0 9"), INITIAL_VOICE_STATE, ctx())).toMatchObject({ ok: false });
  });

  it("jumps, then fills the side jumped to", () => {
    const r = planPhrase(cmds("jump to 26 inside 444"), INITIAL_VOICE_STATE, ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.changes[0].tooth).toBe("26");
    expect(site(r.changes[0].after, "DL")?.pocket_depth).toBe(4);
  });
});

describe("planPhrase on the around-each-tooth route", () => {
  it("six numbers complete one tooth, round it, then the next tooth", () => {
    const around: VoiceContext = { steps: buildRoute("around_tooth", TEETH), draftFor: blank, hasFurcation };
    const r = planPhrase(cmds("323 434"), INITIAL_VOICE_STATE, around);
    if (!r.ok) throw new Error(r.reason);
    const t18 = r.changes[0].after;
    expect(["DB", "B", "MB", "ML", "L", "DL"].map((s) => site(t18, s)?.pocket_depth)).toEqual([3, 2, 3, 4, 3, 4]);
    expect(r.voice.cursor).toEqual({ tooth: "17", side: "outside", offset: 0 });
  });
});

import { draftChanges } from "./voice-apply";

describe("draftChanges (the phrase's lines in the exam transcript)", () => {
  it("lists every cell a phrase changed, old to new, and nothing it didn't", () => {
    const r = planPhrase(cmds("323 recession 1 0 1 bleeding first"), INITIAL_VOICE_STATE, ctx());
    if (!r.ok) throw new Error(r.reason);
    const c = draftChanges(r.changes);
    expect(c).toContainEqual({ tooth: "18", site: "DB", field: "pocket_depth", from: null, to: 3 });
    expect(c).toContainEqual({ tooth: "18", site: "MB", field: "recession", from: null, to: 1 });
    expect(c).toContainEqual({ tooth: "18", site: "DB", field: "bleeding", from: false, to: true });
    expect(c.filter((x) => x.site === "ML")).toEqual([]);
  });

  it("records a skipped tooth, and an undone skip the other way", () => {
    expect(draftChanges([], ["18"])).toEqual([{ tooth: "18", site: null, field: "skipped", from: false, to: true }]);
    expect(draftChanges([], ["18"], true)).toEqual([{ tooth: "18", site: null, field: "skipped", from: true, to: false }]);
  });
});
