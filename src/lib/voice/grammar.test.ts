import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalise } from "./normalise";
import { classifyFlag, parse, parseAlternatives, soundKey } from "./grammar";
import { scoreCase, summarise, type EvalCase } from "./eval";

// The eval set runs in CI, so the grammar can't regress without a key or a microphone.
const { cases } = JSON.parse(readFileSync(join(process.cwd(), "evals/voice/cases.json"), "utf8")) as { cases: EvalCase[] };

describe("voice eval set (evals/voice/cases.json)", () => {
  const s = summarise(cases.map(scoreCase));

  it("never writes a wrong value", () => {
    expect(s.wrong.map((r) => `${r.c.id}: ${JSON.stringify(r.got)}`)).toEqual([]);
  });

  it("gets at least 95% exactly right", () => {
    expect(s.exact / s.n).toBeGreaterThanOrEqual(0.95);
  });

  it("rejects every phrase that must write nothing", () => {
    expect(cases.filter((c) => c.expect === null).map(scoreCase).filter((r) => r.outcome !== "exact")).toEqual([]);
  });
});

describe("normalise", () => {
  it("keeps Chrome's digit strings, splits 3D and minus", () => {
    expect(normalise("3D 114")).toEqual([{ t: "digits", s: "3" }, { t: "word", w: "deep" }, { t: "digits", s: "114" }]);
    expect(normalise("recession -100")).toEqual([{ t: "word", w: "recession" }, { t: "word", w: "minus" }, { t: "digits", s: "100" }]);
  });

  it("turns number words into digits; 'twelve' stays one value", () => {
    expect(normalise("three twelve")).toEqual([{ t: "digits", s: "3" }, { t: "digits", s: "12", whole: true }]);
  });

  it("leaves homophones as words for the grammar to place", () => {
    expect(normalise("jump to")).toEqual([{ t: "word", w: "jump" }, { t: "word", w: "to" }]);
  });
});

describe("flags by sound", () => {
  it("hears 'black', 'Slack', 'plack' as plaque and 'leading' as bleeding", () => {
    expect(soundKey("black")).toBe(soundKey("plaque"));
    for (const w of ["black", "slack", "plack", "flat"]) expect(classifyFlag(w)).toBe("plaque");
    expect(classifyFlag("leading")).toBe("bleeding_on_probing");
    expect(classifyFlag("separation")).toBe("suppuration");
  });

  it("refuses a word that isn't clearly one of the three", () => {
    expect(classifyFlag("first")).toBeNull();
    expect(classifyFlag("hello")).toBeNull();
  });
});

describe("parse", () => {
  it("reads several commands in one phrase", () => {
    expect(parse("323 recession 101 bleeding all")).toEqual({
      ok: true,
      commands: [
        { type: "depths", values: [3, 2, 3] },
        { type: "recession", values: [1, 0, 1] },
        { type: "flag", flag: "bleeding_on_probing", sites: ["first", "middle", "last"] },
      ],
    });
  });

  it("rejects 3124 rather than guessing 3 1 2 4 or 3 12 4, and doesn't fall back to a lower guess", () => {
    expect(parse("3124").ok).toBe(false);
    expect(parseAlternatives(["3124", "324"]).ok).toBe(false);
  });

  it("falls back to a lower guess for a misheard word, but not when lower guesses disagree", () => {
    expect(parseAlternatives(["jump to one side button", "jump to 16 button"])).toMatchObject({ ok: true, used: "jump to 16 button" });
    expect(parseAlternatives(["xyz", "323", "324"]).ok).toBe(false);
  });
});

describe("readPhrase: a phrase cut at a pause", () => {
  // Live, 13 Nov: "434 recession" | "211" — the second half was written as pocket depths.
  it("waits on '434 recession' and joins it to '211'", async () => {
    const { readPhrase } = await import("./grammar");
    const first = readPhrase(["434 recession", "34 recession"], null);
    expect(first.parsed).toMatchObject({ ok: false, incomplete: true });
    expect(readPhrase(["211"], "434 recession").parsed).toMatchObject({
      ok: true,
      commands: [{ type: "depths", values: [4, 3, 4] }, { type: "recession", values: [2, 1, 1] }],
    });
  });

  it("uses a repeated whole phrase on its own when the join doesn't read", async () => {
    const { readPhrase } = await import("./grammar");
    expect(readPhrase(["333"], "33 3 3").parsed).toMatchObject({ ok: true, commands: [{ type: "depths", values: [3, 3, 3] }] });
  });

  it("never joins undo", async () => {
    const { readPhrase } = await import("./grammar");
    expect(readPhrase(["undo"], "434 recession").parsed).toMatchObject({ ok: true, commands: [{ type: "undo" }] });
  });
});
