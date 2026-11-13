# Voice perio: browser speech recognition and a rule grammar, no language model yet

## Status

accepted (13 Nov 2026)

## Decision

Voice perio entry uses Chrome's built-in speech recognition (Web Speech API, `en-IN`) for speech
to text, and a deterministic, tested grammar for text to measurements. Both stages are pure,
separately testable modules (`src/lib/voice/`); the speech stage sits behind a small interface
so a hosted or local recogniser can replace it. There is no language-model stage in the pilot.

## Context

The handoff planned two stages: a deterministic parser for plain number sequences, and a hosted
model (Claude) for everything else — jumps, flags, skips and corrections — returning
Zod-validated structured output.

Two things changed that:

- **No API key.** The pilot has no budget for a paid model.
- **Measured, the problem is hearing, not understanding.** Three reading rounds
  (`docs/specs/voice-perio.md`, Feasibility) showed numbers heard 15/15 and clinical words
  heard badly (mesial → "museum", furcation → "vacation", plaque → "black"). A language model
  receives the same mistaken text, so it can't recover what wasn't heard. What does work is
  constraining the choice: in the slot where a flag can appear, a word only has to sound more
  like one of three flags than the other two. Rules do that deterministically, offline and
  instantly, and give the same answer every time, which matters for clinical data under the
  "never write a guess" rule.

## Consequences

- The dentist uses a fixed set of phrases (as commercial voice charting does). Anything else
  writes nothing and is shown in red.
- **Relation to ADR-0001:** unchanged. Nothing here needs Python or an ML service. A future model
  stage (a hosted model called from a TypeScript service behind `/api/v1/`, or a local one)
  would also not conflict with ADR-0001, which defers *training our own* models, not calling
  one. It would slot in after the grammar, for phrases the grammar rejects, under the same
  validate-then-apply-all-or-nothing rule.
- **Privacy:** Chrome's recogniser streams audio to Google. Demo patients only until a
  recogniser that runs on the device (e.g. Whisper locally) replaces it. That replacement is
  also the real fix for misheard clinical words, because it can be told which words to expect.
- **Free-text notes** ("generalised bleeding, poor home care") are where a model would add the
  most, and are out of scope for the pilot.
