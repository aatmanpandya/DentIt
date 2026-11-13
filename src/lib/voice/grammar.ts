/**
 * Voice perio, stage 3: tokens → commands (docs/specs/voice-perio.md, "What can be said").
 *
 * Deterministic, no network, no model (ADR-0004). Either the whole phrase parses or nothing
 * does: one word the grammar can't place rejects the phrase, so nothing is written from it.
 *
 * Word lists include how Chrome actually misheard them in three reading rounds
 * (evals/voice/spike-results/) — "museum" for mesial, "vacation" for furcation. A misheard
 * word is only accepted in the one slot where it can appear (a site word after a flag, a
 * flag before its sites), so "museum" can never mean anything else. Flags are matched by
 * sound, three ways: in that slot the word only has to sound more like bleeding,
 * suppuration or plaque than the other two.
 */
import { normalise, type Token } from "./normalise";

export type SiteRef = "first" | "middle" | "last" | "mesial" | "distal";
export type Side = "outside" | "inside";
export type FlagName = "bleeding_on_probing" | "suppuration" | "plaque";

export type VoiceCommand =
  | { type: "depths"; values: number[] }
  | { type: "recession"; values: number[] }
  | { type: "flag"; flag: FlagName; sites: SiteRef[] }
  | { type: "mobility"; value: number }
  | { type: "furcation"; value: number }
  | { type: "jump"; tooth: string; side: Side | null }
  | { type: "missing"; tooth: string }
  | { type: "back" }
  | { type: "undo" }
  | { type: "correction"; value: number };

// `numbers`: rejected because the numbers themselves were ambiguous or out of range — another
// of Chrome's guesses must not be used instead (it would be a guess at the numbers).
// `incomplete`: the phrase stopped where numbers were still due ("434 recession", "33") — Chrome
// splits a phrase at a pause, so the caller holds it and joins it to the next one.
export type ParseResult = { ok: true; commands: VoiceCommand[] } | { ok: false; reason: string; numbers?: boolean; incomplete?: boolean };

const FILLERS = new Set(["and", "the", "is", "are", "a", "um", "uh", "okay", "ok", "it", "index", "dental", "side", "please", "then"]);

// Number homophones, accepted only inside a number slot.
const HOMOPHONES: Record<string, string> = { to: "2", too: "2", for: "4", tree: "3", ate: "8", won: "1" };

const SITE_WORDS: Record<string, SiteRef | "all"> = {
  all: "all", mall: "all", present: "all", on: "all", wall: "all",
  first: "first", forest: "first", fast: "first",
  middle: "middle", medal: "middle", mid: "middle",
  last: "last", lost: "last",
  mesial: "mesial", museum: "mesial", music: "mesial", musical: "mesial", measles: "mesial", medial: "mesial", measure: "mesial",
  distal: "distal", digital: "distal", distance: "distal", distil: "distal",
};

const SIDE_WORDS: Record<string, Side> = {
  outside: "outside", buccal: "outside", button: "outside", facial: "outside", cheek: "outside",
  inside: "inside", lingual: "inside", palatal: "inside", palatine: "inside", palatin: "inside", tongue: "inside",
};

const FURCATION_WORDS = new Set(["furcation", "vacation", "vocation", "occasion", "education", "purchasing", "furcations", "forcian", "forcion", "forshan", "fortian"]);
const RECESSION_WORDS = new Set(["recession", "session", "resection"]);
const UNDO_WORDS = new Set(["undo", "undu", "andu"]);

const FLAG_SPELLINGS: Record<FlagName, string[]> = {
  // Not "bleed": its sound key ("plat") ties with plaque's mishearings ("plot", live 13 Nov).
  bleeding_on_probing: ["bleeding", "leading", "pleading"],
  suppuration: ["suppuration", "separation", "exudate"],
  plaque: ["plaque", "plak", "plack", "black", "slack", "flat", "plat", "plant", "plot", "plate", "flag", "play", "delete", "deposits", "debris", "debri", "dibri", "dabri", "biofilm", "biofil"],
};

/**
 * A rough sound key: vowels collapse, voiced/unvoiced pairs merge (b/p, d/t, g/k, v/f), c/q
 * become k, repeats collapse, trailing vowels drop. "black", "plaque" and "plack" all become
 * "plak". Crude by design — it only ever has to separate three very different words.
 */
export function soundKey(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z]/g, "");
  s = s.replace(/ph/g, "f").replace(/ck|q|c|x/g, "k").replace(/[hwy]/g, "");
  s = s.replace(/b/g, "p").replace(/d/g, "t").replace(/g/g, "k").replace(/v/g, "f").replace(/z/g, "s");
  s = s.replace(/[aeiou]+/g, "a").replace(/(.)\1+/g, "$1").replace(/a+$/, "");
  return s;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Which flag a word in the flag slot means, or null if it isn't clearly one of the three. */
export function classifyFlag(word: string): FlagName | null {
  for (const [flag, spellings] of Object.entries(FLAG_SPELLINGS) as [FlagName, string[]][]) {
    if (spellings.includes(word)) return flag;
  }
  const key = soundKey(word);
  // Short keys match too much ("hello" → "al" is one edit from "pla"): only trust 3+ sounds.
  if (key.length < 3) return null;
  const best = (Object.entries(FLAG_SPELLINGS) as [FlagName, string[]][])
    .map(([flag, spellings]) => ({ flag, d: Math.min(...spellings.map((s) => editDistance(key, soundKey(s)))) }))
    .sort((a, b) => a.d - b.d);
  // Close to one flag (at most 1 sound edit) and clearly closer to it than to the others.
  if (best[0].d <= 1 && best[1].d - best[0].d >= 2) return best[0].flag;
  return null;
}

const isWord = (t: Token | undefined, ...words: string[]) => t?.t === "word" && words.includes(t.w);
const word = (t: Token | undefined) => (t?.t === "word" ? t.w : null);

function validTooth(s: string): boolean {
  return /^[1-4][1-8]$/.test(s) || /^[5-8][1-5]$/.test(s);
}

export function parse(transcript: string): ParseResult {
  const tokens = normalise(transcript).filter((t) => !(t.t === "word" && FILLERS.has(t.w)));
  const commands: VoiceCommand[] = [];
  let i = 0;

  const fail = (reason: string): ParseResult => ({ ok: false, reason });
  const failNumbers = (reason: string): ParseResult => ({ ok: false, reason, numbers: true });
  const waiting = (reason: string): ParseResult => ({ ok: false, reason, numbers: true, incomplete: true });
  const atEnd = () => i >= tokens.length;

  /** Reads a run of numbers (digits, homophones in the middle of a run, "deep", "minus"). */
  function readRun(opts: { deep?: boolean; minus?: boolean; homophonesAtStart?: boolean }) {
    const items: ({ k: "digits"; s: string; whole?: boolean } | { k: "deep" } | { k: "minus" })[] = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.t === "digits") items.push({ k: "digits", s: t.s, whole: t.whole });
      else if (opts.deep && t.w === "deep") items.push({ k: "deep" });
      else if (opts.minus && t.w === "minus") items.push({ k: "minus" });
      else if (HOMOPHONES[t.w] && (items.length > 0 || opts.homophonesAtStart)) items.push({ k: "digits", s: HOMOPHONES[t.w] });
      else break;
      i++;
    }
    return items;
  }

  /** Expands a depth run into values: digit strings split per digit, "deep" takes two digits. */
  function depthValues(items: ReturnType<typeof readRun>): number[] | string {
    const values: number[] = [];
    let deepPending = false;
    for (const it of items) {
      if (it.k === "deep") {
        if (deepPending) return "“deep” twice in a row.";
        deepPending = true;
        continue;
      }
      if (it.k === "minus") return "A pocket depth can't be negative.";
      if (it.whole) {
        values.push(Number(it.s));
        deepPending = false;
        continue;
      }
      let digits = it.s;
      if (deepPending) {
        // A deep pocket is 10-15: always two digits starting with 1.
        if (digits.length < 2 || digits[0] !== "1" || Number(digits.slice(0, 2)) > 15) return `“deep ${digits}” isn't a pocket of 10–15 mm.`;
        values.push(Number(digits.slice(0, 2)));
        digits = digits.slice(2);
        deepPending = false;
      }
      for (const d of digits) values.push(Number(d));
    }
    if (deepPending) return "“deep” needs a number after it.";
    return values;
  }

  /** "two", "grade two", "to" — a single 0-3 value for mobility or furcation. */
  function readGrade(what: string): number | string {
    if (isWord(tokens[i], "grade", "grades", "great")) i++;
    const items = readRun({ homophonesAtStart: true });
    if (items.length !== 1 || items[0].k !== "digits" || items[0].s.length !== 1) return `Say ${what} as one number, 0 to 3.`;
    const v = Number(items[0].s);
    return v <= 3 ? v : `${what[0].toUpperCase() + what.slice(1)} is 0 to 3.`;
  }

  while (i < tokens.length) {
    const t = tokens[i];
    const w = word(t);

    // Numbers first: depths, or "<tooth> missing".
    if (t.t === "digits" || w === "deep") {
      const items = readRun({ deep: true });
      if (isWord(tokens[i], "missing", "absent")) {
        i++;
        const tooth = items.map((x) => (x.k === "digits" ? x.s : "")).join("");
        if (!validTooth(tooth)) return fail(`“${tooth}” isn't a tooth.`);
        commands.push({ type: "missing", tooth });
        continue;
      }
      const values = depthValues(items);
      if (typeof values === "string") return atEnd() && values.includes("needs a number") ? waiting("Waiting for the number after “deep”…") : failNumbers(values);
      if (commands.length === 0 && atEnd() && values.length > 0 && values.length < 3 && !items.some((x) => x.k === "deep"))
        return waiting(`Heard ${values.join(" ")} — waiting for the rest…`);
      // Pauses don't survive: "three, twelve, four" comes back "3124", indistinguishable from
      // 3 1 2 4. A side is three sites, so a plain run must come in threes; a 10-15 mm pocket is
      // said with "deep". Catches 3124 / 1065; can't catch "311" meant as 3, 11 (spec, Evals).
      if (!items.some((x) => x.k === "deep" || (x.k === "digits" && x.whole)) && values.length % 3 !== 0)
        return failNumbers(`Heard ${values.length} numbers — say three per side, and “deep twelve” for 10–15 mm.`);
      commands.push({ type: "depths", values });
      continue;
    }

    if (w && RECESSION_WORDS.has(w)) {
      i++;
      const items = readRun({ minus: true, homophonesAtStart: true });
      const values: number[] = [];
      let negative = false;
      for (const it of items) {
        if (it.k === "minus") {
          negative = true;
          continue;
        }
        if (it.k !== "digits") continue;
        const chars = it.whole ? [it.s] : it.s.split("");
        chars.forEach((c, n) => {
          values.push(negative && n === 0 ? -Number(c) : Number(c));
        });
        negative = false;
      }
      if (values.length < 3 && atEnd()) return waiting("Waiting for the recession numbers…");
      if (values.length !== 3) return failNumbers("Say recession as three numbers, e.g. “recession one zero one”.");
      commands.push({ type: "recession", values });
      continue;
    }

    if (w === "mobility") {
      i++;
      const v = readGrade("mobility");
      if (typeof v === "string") return atEnd() ? waiting("Waiting for the mobility number…") : failNumbers(v);
      commands.push({ type: "mobility", value: v });
      continue;
    }

    // "for Asian grade 1", "for grade 1" (live): "for" + a furcation-ish word or "grade". Mobility
    // always says "mobility", so a lone "grade N" after "for" can only be furcation.
    const forFurcation = w === "for" && (FURCATION_WORDS.has(word(tokens[i + 1]) ?? "") || isWord(tokens[i + 1], "asian", "station"));
    if (w && (FURCATION_WORDS.has(w) || forFurcation || (w === "for" && isWord(tokens[i + 1], "grade")))) {
      i += forFurcation ? 2 : 1;
      const v = readGrade("furcation");
      if (typeof v === "string") return atEnd() ? waiting("Waiting for the furcation grade…") : failNumbers(v);
      commands.push({ type: "furcation", value: v });
      continue;
    }

    if (w === "jump" || w === "go") {
      i++;
      if (isWord(tokens[i], "to", "too")) i++;
      const items = readRun({});
      const tooth = items.map((x) => (x.k === "digits" ? x.s : "")).join("");
      if (!tooth && atEnd()) return waiting("Waiting for the tooth…");
      if (!validTooth(tooth)) return fail(tooth ? `“${tooth}” isn't a tooth.` : "Say which tooth, e.g. “jump one six outside”.");
      const sideWord = word(tokens[i]);
      const side = sideWord ? (SIDE_WORDS[sideWord] ?? null) : null;
      if (side) i++;
      commands.push({ type: "jump", tooth, side });
      continue;
    }

    if (w === "back") {
      i++;
      commands.push({ type: "back" });
      continue;
    }

    if (w && UNDO_WORDS.has(w)) {
      i++;
      commands.push({ type: "undo" });
      continue;
    }

    // "no, make that four" / "make that deep twelve".
    if (w === "no" || w === "make" || w === "makes") {
      while (isWord(tokens[i], "no", "make", "makes", "that", "it's", "its")) i++;
      const values = depthValues(readRun({ deep: true, homophonesAtStart: true }));
      if (typeof values === "string") return failNumbers(values);
      if (values.length !== 1) return failNumbers("Correct one number at a time, e.g. “no, make that four”.");
      commands.push({ type: "correction", value: values[0] });
      continue;
    }

    // "<anything> grade N" is furcation: "grade" belongs only to mobility and furcation, and
    // mobility is always said "mobility". Live, furcation came back "hurrication", "frication",
    // "friction", "fusion", "for cash on" — no word list keeps up. Up to three unknown words,
    // none of them a flag or a site word.
    {
      let j = i;
      while (j < tokens.length && j - i < 3 && tokens[j].t === "word" && !isWord(tokens[j], "grade", "grades", "great", "mobility") && SITE_WORDS[word(tokens[j]) ?? ""] === undefined && !classifyFlag(word(tokens[j]) ?? "")) j++;
      if (j > i && isWord(tokens[j], "grade", "grades", "great")) {
        i = j;
        const v = readGrade("furcation");
        if (typeof v === "string") return atEnd() ? waiting("Waiting for the furcation grade…") : failNumbers(v);
        commands.push({ type: "furcation", value: v });
        continue;
      }
    }

    // A flag: <word that sounds like a flag> <site> [and <site>…] — or "all"/"present".
    if (w && SITE_WORDS[word(tokens[i + 1]) ?? ""] !== undefined) {
      const flag = classifyFlag(w);
      if (!flag) return fail(`Didn't catch “${w}” — bleeding, suppuration or plaque?`);
      i++;
      const sites = new Set<SiteRef>();
      let all = false;
      while (i < tokens.length && SITE_WORDS[word(tokens[i]) ?? ""] !== undefined) {
        const s = SITE_WORDS[word(tokens[i]) as string];
        if (s === "all") all = true;
        else sites.add(s);
        i++;
      }
      commands.push({ type: "flag", flag, sites: all ? ["first", "middle", "last"] : [...sites] });
      continue;
    }

    return fail(`Didn't understand “${w}”.`);
  }

  if (commands.length === 0) return fail("Nothing to enter.");
  if (commands.some((c) => c.type === "undo") && commands.length > 1) return fail("Say “undo” on its own.");
  return { ok: true, commands };
}

/**
 * Chrome returns up to five guesses, best first. The best one is used if it parses. If it
 * doesn't because of a misheard word (not because its numbers were ambiguous), the lower guesses
 * are tried — but only used if every one of them that parses agrees,
 * so a fallback is never a coin-flip between readings.
 */
/** The tooth digits said after "jump" in one guess, valid or not ("jump to one" → "1"). */
function jumpDigits(text: string): string | null {
  const tokens = normalise(text);
  const at = tokens.findIndex((t) => t.t === "word" && (t.w === "jump" || t.w === "go"));
  if (at === -1) return null;
  let i = at + 1;
  if (tokens[i]?.t === "word" && ["to", "too"].includes((tokens[i] as { w: string }).w)) i++;
  let digits = "";
  while (tokens[i]?.t === "digits") digits += (tokens[i++] as { s: string }).s;
  return digits;
}

export function parseAlternatives(alternatives: string[]): ParseResult & { used?: string } {
  if (alternatives.length === 0) return { ok: false, reason: "Nothing heard." };
  const top = parse(alternatives[0]);
  if (top.ok) return guardJump({ ...top, used: alternatives[0] }, alternatives);
  // The best guess's numbers were ambiguous ("3124" for "three twelve four"): a lower guess with
  // different numbers ("324") would be a guess at the values. Write nothing.
  if (top.numbers) return top;
  const others = alternatives.slice(1).map((a) => ({ a, r: parse(a) })).filter((x) => x.r.ok) as { a: string; r: { ok: true; commands: VoiceCommand[] } }[];
  if (others.length === 0) return top;
  const first = JSON.stringify(others[0].r.commands);
  if (others.some((o) => JSON.stringify(o.r.commands) !== first)) return { ok: false, reason: `Heard “${alternatives[0]}” — not sure what was meant. Say it again.` };
  return guardJump({ ...others[0].r, used: others[0].a }, alternatives);
}

/**
 * "jump to one one" came back "jump 21" (live, 13 Nov): "to" swallowed into the number, and every
 * value after it landed one tooth off. If Chrome's guesses disagree about the jump's tooth, don't
 * move — except when one is just the other with a trailing digit lost or added ("1" beside "16",
 * "six" heard as "side"; "111" beside "11"), which can't put the cursor on a different tooth.
 */
function guardJump(result: { ok: true; commands: VoiceCommand[]; used: string }, alternatives: string[]): ParseResult & { used?: string } {
  const jump = result.commands.find((c) => c.type === "jump");
  if (!jump || jump.type !== "jump") return result;
  const conflict = alternatives.some((a) => {
    const d = jumpDigits(a);
    return d !== null && d !== "" && d !== jump.tooth && !jump.tooth.startsWith(d) && !d.startsWith(jump.tooth);
  });
  if (!conflict) return result;
  return { ok: false, numbers: true, reason: `Not sure which tooth (heard “${alternatives[0]}”). Say “jump”, then the tooth, without “to”: “jump one one inside”.` };
}

/**
 * Reads a phrase, joined to a cut-off one still waiting for its numbers (`pending`). Chrome
 * splits a phrase at a pause — live, "434 recession" | "211" wrote 2 1 1 as pocket depths. The
 * joined reading is used if it works or still waits; if it doesn't but the new phrase works on
 * its own (the dentist repeated the whole thing), that's used. "undo" is never joined.
 */
export function readPhrase(alternatives: string[], pending: string | null): { parsed: ParseResult & { used?: string }; alternatives: string[] } {
  const alone = parseAlternatives(alternatives);
  if (!pending || (alone.ok && alone.commands[0].type === "undo")) return { parsed: alone, alternatives };
  const joinedAlternatives = alternatives.map((a) => `${pending} ${a}`);
  const joined = parseAlternatives(joinedAlternatives);
  if (joined.ok || joined.incomplete || !alone.ok) return { parsed: joined, alternatives: joinedAlternatives };
  return { parsed: alone, alternatives };
}
