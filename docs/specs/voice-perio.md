# Voice perio entry (Phase 3)

A dentist probing gums has gloved hands and today calls numbers out for someone else to type.
With voice entry they speak and the exam grid fills. Decided 13 Nov with the owner; the input
model rests on `perio.md` and `pilot-foundations.md` §2. Design record: ADR-0004.

## Pipeline

```
mic ─► Chrome speech recognition (en-IN, up to 5 guesses per phrase)       src/lib/voice/stt.ts
     ─► normalise: words → tokens ("323" → 3 2 3, "3D" → 3 deep, "to" → 2 in a number slot)
                                                                           src/lib/voice/normalise.ts
     ─► grammar: tokens → commands, or "not understood"                    src/lib/voice/grammar.ts
     ─► plan: commands → the entry reducer's own actions, dry-run on a copy src/components/perio/voice-apply.ts
     ─► apply all of them, or none                                          use-perio-entry.ts
```

Each of Chrome's guesses is tried in order; the first that parses fully is used. If two
guesses parse to different results, nothing is written. **One entry path:** voice only
produces the actions the keyboard already uses (`jump`, `digit`, `dash`, `flag`, menu
selection), through the same reducer, so the range checks (pocket 0–15, recession −5 to 10),
per-tooth saving and skip handling stay identical.

**Never write a guess.** A phrase is applied to a copy of the entry state first. If any part is
not understood, out of range, or ambiguous, nothing is written and the transcript shows red with
the reason. Every cell a phrase changed is highlighted, and "undo" (spoken or a button) takes
back the whole last phrase, including what was already saved.

No language model: there is no API key for the pilot, and three reading rounds showed the
problem is mishearing, which a model reading the same text can't fix (ADR-0004).

## Route

Voice follows the clinic's probing route, one side of a tooth at a time, three sites per side
in the direction the probe travels:

| Route | Order |
|---|---|
| **Outside first** (default; Dr Nimisha's "clockwise") | outside 18→28, outside 38→48, inside 48→38, inside 28→18 |
| Each jaw first | outside 18→28, inside 28→18, inside 48→38, outside 38→48 |

Within a side the three sites are read in travel order: moving 18→28 on the outside, upper-right
teeth are DB, B, MB and upper-left teeth MB, B, DB. Skipped and missing teeth are passed over.
The keyboard keeps its per-tooth order; both drive the same reducer. For the pilot the route is
picked next to the Dictate button and remembered per device; making it a clinic setting is a
later change (`organizations.probing_sequence` holds the keyboard's tooth order only).

## What can be said

| Say | Means |
|---|---|
| "three two three" | pocket depths for the current side; then the next tooth on the route |
| "three two three, recession one zero one" | depths and recession together |
| "deep twelve", "three deep eleven four" | a 10–15 mm pocket: the two digits after "deep" are one value |
| "recession one zero one" | recession for the side just entered |
| "bleeding all", "bleeding first / middle / last" | bleeding on the side just entered |
| "suppuration …", "plaque …" | the same, for suppuration and plaque |
| "mobility two", "furcation grade one" | per-tooth values for the current tooth |
| "jump to one six outside" | move the cursor |
| "one eight is missing" | skip that tooth |
| "back" | the previous side |
| "no, make that four" | replace the last pocket depth entered |
| "undo" | take back the whole last phrase |

Sites: "first / middle / last" in travel order. "mesial" and "distal" are accepted. Sides:
"outside / inside"; "buccal", "lingual", "palatal" accepted.

## Undo and the save API

"Undo" restores every site the phrase touched to exactly what it was. A site that was empty goes
back to empty, which the tooth save couldn't do (it only adds or changes), so
`PUT /perio-exams/:id/teeth/:tooth` takes `clear_sites: ["MB", …]`; mobility/furcation that were
unset are sent back as `null`. Up to 50 phrases can be undone, newest first.

In development, `window.__dentitVoice("323")` feeds a phrase in as if Chrome had heard it, so the
whole path can be tested without a microphone.

## Feasibility: what Chrome actually hears

Three reading rounds, one Indian-English speaker, Chrome 157, `en-IN`, 55 lines
(`evals/voice/spike-callouts*.json`, raw results in `evals/voice/spike-results/`).

- **Numbers: 15/15 heard correctly**, always as a digit string ("323", "232323"), never as
  words. Recession and minus too ("323 recession 101", "recession -100").
- **Pauses don't separate numbers.** "three, twelve, four" → "3124", the same as 3, 1, 2, 4.
  Hence "deep": "deep 12" came back exactly, and "3D 114" (three, deep eleven, four) parses.
- **Clinical words mostly misheard:** mesial → museum/music/measles; distal → digital/distance;
  bleeding → leading/pleading; furcation → vacation/vocation/purchasing; cheek side → Street side;
  "go to two four" → 2224; buccal → button; pus → first/bus.
- **Heard well:** outside, inside, first, middle, last, back, undo, missing, recession,
  mobility, deep, grade, jump, deposits, debris, exudate.
- **Plaque** came back as five different words when said loosely; said "plak" (short a, hard k),
  as **black** 4 times of 5. **Suppuration** came back as **separation** 4 of 4.
- So flags are matched by sound in the one place a flag can appear (before all / first / middle
  / last): the word only has to sound more like bleeding, suppuration or plaque than the other
  two. A sound-match outside that slot means nothing.
- About 2–3 s from the end of speech to the final text.

## Evals

`npm run eval:voice` runs every case in `evals/voice/cases.json` through normalise → grammar →
plan against a fixed exam state and prints exact-match accuracy overall and by category, and
**wrong values written** (target 0: a phrase either writes exactly the expected values or nothing).
Cases come from the real transcripts above plus constructed mishearings; the same cases run in
`npm test`, so CI covers them.

## Scope cuts

- No language model stage (ADR-0004); free-form phrasing is not understood and writes nothing.
- Chrome only. Audio goes to Google's speech service: demo patients only.
- Dictated free-text notes: later.
