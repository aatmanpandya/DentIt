/**
 * Voice perio, stage 2: a speech transcript → tokens (docs/specs/voice-perio.md).
 *
 * Chrome returns numbers as digit strings ("323", "3124", "-100") and sometimes as words; this
 * turns both into digit tokens and leaves everything else as lower-case words. Ambiguous
 * homophones ("to", "for", "ate") stay words — only the grammar knows whether a number belongs
 * there ("jump to 16" vs "mobility to"). Pure, no DOM.
 */

// `whole`: a number spoken as one word ("twelve") is one value, never split into digits.
export type Token = { t: "digits"; s: string; whole?: boolean } | { t: "word"; w: string };

// Unambiguous number words. "to/too", "for", "ate", "tree", "won" are homophones and are
// resolved by the grammar in a number slot only.
const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
};

export function normalise(transcript: string): Token[] {
  const text = transcript
    .toLowerCase()
    .replace(/[,.;:!?"]/g, " ")
    .replace(/\bout side\b/g, "outside")
    .replace(/\bin side\b/g, "inside");

  const tokens: Token[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    // "3d" is Chrome's spelling of "three deep" (round 2: "3D 114" for "three, deep eleven, four").
    const deep = raw.match(/^(\d+)d$/);
    if (deep) {
      tokens.push({ t: "digits", s: deep[1] }, { t: "word", w: "deep" });
      continue;
    }
    // "-100" — "recession minus one zero zero".
    const minus = raw.match(/^-(\d+)$/);
    if (minus) {
      tokens.push({ t: "word", w: "minus" }, { t: "digits", s: minus[1] });
      continue;
    }
    if (/^\d+$/.test(raw)) {
      tokens.push({ t: "digits", s: raw });
      continue;
    }
    // "1/4", "16th" and other digit-with-junk forms are left as words: the grammar rejects them.
    const n = NUMBER_WORDS[raw];
    tokens.push(n !== undefined ? { t: "digits", s: n, ...(n.length > 1 ? { whole: true } : {}) } : { t: "word", w: raw });
  }
  return tokens;
}
