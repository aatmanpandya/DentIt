# Perio charting (Day 14-17)

Decisions from grilling on 2026-08-19, before implementation. This is the spec the Day 14-17
build works from — see `docs/specs/pilot-foundations.md §2` for the measurement set this expands
(sites, ranges, schema, the per-tooth advance requirement, RBAC), `docs/specs/data-model.md` for
`perio_exams`/`perio_tooth_records`/`perio_site_measurements`, `docs/specs/api-surface.md` for the
already-spec'd perio endpoints, and `docs/specs/odontogram.md`'s "Handoff to Perio" section for
the three decisions carried over from the Odontogram build (missing-tooth auto-skip,
crown/implant informational-only, primary-teeth auto-skip). Nothing in those documents is
re-litigated here — only the interaction model they left open.

## Grid & layout

**Standalone tabular grid** (teeth × sites), independent of the Odontogram's tooth-shape geometry
(`odontogram-teeth.ts`) — a dense keyboard-drivable grid of ~224 values per exam (32 teeth × 6
sites × up to 5 fields, plus 2 per-tooth fields) can't be laid out on anatomical tooth silhouettes.
That geometry is reserved for the separate read-only graphical overlay (below).

**Traversal order** — `docs/specs/pilot-foundations.md §2`'s default sequence: upper buccal
`18→28`, upper lingual `28→18`, lower buccal `48→38`, lower lingual `38→48`. **Configurable per
Organization** via `organizations.probing_sequence` (jsonb, already in schema) — when null, the
service falls back to this hardcoded default. No settings UI is built for this yet (single-org
pilot); an owner-only `PATCH` on the organization record is enough to set it via API/DB for now,
consistent with `org_settings` being owner-only per the RBAC matrix.

## Data entry

Adopted from real precedent (OpenDental/Dentrix keyboard conventions), not invented from scratch —
verified against their documented shortcut behavior rather than assumed:

- **Pocket depth**: bare digit `0`-`9` commits the value and auto-advances (no Enter). `-` then a
  digit gives `10`-`19` (numeric-keypad convention, covers the full 0-15 range).
- **Gingival margin**: bare digit commits as **positive** (recession, margin apical to CEJ — the
  common clinical case); a `-` prefix (same mechanism as pocket depth's tens-prefix, not a
  modifier key) flags the next digit as **negative** (margin coronal to CEJ, uncommon). Never flip
  this sign — per `pilot-foundations.md`'s explicit warning, positive = recession.
  **Not `Ctrl`/`Cmd`+digit** — that was the original design (matching OpenDental's own convention)
  and it does work under Playwright's synthetic key events, which is how it first passed live
  verification. It does not work for a real user: browsers reserve `Ctrl`+`1`-`9` (`Cmd`+`1`-`9` on
  Mac) for tab-switching at the chrome level, and that keydown never reaches the page's JavaScript
  at all. Caught only when the user tried it by hand in an actual browser window — a reminder that
  Playwright automation of a keyboard shortcut isn't proof a human can use it; OS/browser-reserved
  combinations need a real keypress, not a scripted one, to verify.
- **Per-site advance is a 3-stop chain**: PD → GM → a flags stop (`B`/`S`/`P` settable here) →
  next site's PD. Matches OpenDental's own documented advance sequence. The flags stop is **not a
  hard block** — per `pilot-foundations.md`'s explicit recommendation, an untouched
  bleeding/suppuration/plaque flag defaults to `false` and the operator advances freely; blocking
  on unticked boxes would stall the operator constantly.
- **Click-to-position, for mouse parity**: clicking any non-skipped site cell (any tooth, not just
  the current one) moves the keyboard cursor there — mouse decides *where*, keyboard still does
  *all* the mutating. Satisfies `pilot-foundations.md`'s "any cell is directly clickable" without
  needing an on-screen numeric picker. Clicking a cell already holding data loads its known values
  first (never overwrites with blanks), and clicking away from a tooth with any in-progress,
  not-yet-fully-saved sites fires a partial save before jumping — caught live: the first version
  silently discarded a real, already-typed measurement the instant a different tooth was clicked,
  since `save_tooth` only otherwise fires on full 6-site completion.
- **Mobility & furcation** (per-tooth, not per-site): dedicated `M`/`F` keys open a small
  classification menu (arrow keys or digit `0`-`3` to pick), outside the main auto-advance stream
  — matches Dentrix's own mobility/furcation shortcut behavior. `F` is only offered on
  furcation-eligible teeth (`hasFurcation()` in `src/server/lib/tooth-notation.ts` — molars + `14`/
  `24`), unaffected by crown/implant status per the Odontogram handoff.
- **Out-of-range keystrokes rejected with an error** (PD > 15, GM outside -5..10) — not silently
  dropped, not clamped.

**Advance is per tooth, not per site** — the single most important interaction detail per
`pilot-foundations.md`: the cursor only moves to the next tooth once every measurement for the
current tooth is entered (or defaulted-false for flags). Completing the last site's flag stop
fires the per-tooth `PUT .../teeth/:tooth` (bundling mobility/furcation + all 6 sites) and advances
into the next tooth's first field — one unbroken keystroke stream for the whole exam, no separate
confirm action.

**Failed per-tooth saves — per `docs/specs/validation-and-errors.md`'s explicit exception for this
grid**: the tooth stays visibly unsaved, entry continues uninterrupted (never a blocking modal —
"an operator mid-exam with gloves on cannot deal with a modal"), and a **retry queue drains
automatically in the background**. This is not a user-driven "click retry" — the queue itself
resolves once connectivity/the request recovers.

## Skip handling

Applies to three cases: auto-skip (missing tooth, via `getToothState()`), auto-skip (primary
tooth, per AAPD guidance in the Odontogram handoff), and **manual skip** (an otherwise-normal
tooth the patient can't tolerate probing on — explicitly required by `pilot-foundations.md`).

**Symmetric toggle, one mechanism for all three cases**: a skipped tooth's column renders greyed
out and non-focusable, keyboard nav skips over it entirely. The column header's click/keypress
toggles skip **on or off** for any tooth — reverting an auto-skip, or manually skipping a normal
tooth mid-exam. No separate UI mode for "manual" vs. "auto" skip; the mechanism doesn't care which
triggered it.

## CAL display

Computed and shown **live, inline per site**, the instant both PD and GM are entered for that
site — CAL is the number a clinician actually reads, not an afterthought computed only at review
time. Never stored (`pocket_depth + gingival_margin`, computed on every read).

## Graphical overlay

The classic PD/CAL line-graph strip (the traditional printed-perio-chart visualization) —
**read-only**, reflecting saved state, refreshing after each per-tooth save (not live-while-typing,
since it reads from what's persisted and the save boundary is per-tooth). Lets the dentist eyeball
the whole arch's shape at a glance. This is the one place the Odontogram's tooth geometry
(`odontogram-teeth.ts`) gets reused — as a read surface, not the entry grid.

## Comparison view

`GET /perio-exams/:id/compare?against=` — a **toggle on the same grid**, not a separate page.
Each site cell shows the delta as a small badge next to its current value; **≥2mm CAL change is
flagged** as clinically significant (vs. ~1mm normal probing-depth measurement variability).
Defaults to the most-recent-prior exam automatically (zero extra clicks for the common case); the
exam-history sidebar (below) doubles as an explicit picker for comparing against something older.

## Exam lifecycle

- **Shell starts empty.** `POST /patients/:id/perio-exams` does **not** pre-fill sites with
  healthy defaults — pre-filling would let an unprobed, skipped site silently read as false-healthy
  data, a patient-safety risk the seed loader's own convenience-fill (for demo/test data, not
  clinical entry) doesn't carry.
- **`provider_id`** ("who performed this exam") is **pickable at creation**, not defaulted silently
  to the actor — listed broadly across clinical staff (Owner/Provider/Hygienist/Assistant), since
  the person entering data at the keyboard (e.g. an assistant transcribing) is often not the person
  who actually probed. Decoupled from write-RBAC (below).
- **`perio_exams.notes`** gets its own field, displayed **below the periochart on the same page** —
  deliberately more accessible than the separate Clinical Notes tab, since exam-specific notes
  ("patient couldn't tolerate posterior probing today") are needed at the point of charting, not a
  tab-switch away.
- **Exam history navigation**: a sidebar listing exam dates (also the comparison-baseline picker,
  above).
- **`complete` locks non-skip fields** — a completed exam becomes a point-in-time clinical record,
  same norm as signing a clinical note. Attempting to edit it returns the already-reserved
  `PERIO_EXAM_COMPLETED` error (`docs/specs/validation-and-errors.md`), the perio equivalent of
  `NOTE_ALREADY_SIGNED`.
- **Explicit un-complete is allowed** (no separate amend-exam path exists the way notes has
  amend-note) — reopens the exam to draft. Goes through `writeAudit` like every other mutation in
  this codebase (`PERIO_EXAM_UNCOMPLETED` — actor, exam id, timestamp). No forced reason-text field,
  consistent with `deleteProcedure` not requiring one either.

## RBAC

**Not the same role set as Clinical Notes** — verify against `src/server/lib/permissions.ts`
before assuming otherwise. The `perio` resource already exists there:

```
perio: { owner: [read,write], admin: [read],
         provider: [read,write], hygienist: [read,write], assistant: [read,write] }
```

Assistants get write access, unlike `clinical_notes` — confirmed with the partner clinic per
`pilot-foundations.md §2`: *"Both dentists and assistants record perio... both must have write
access"* (assistants transcribe called-out readings; they don't exercise independent clinical
judgement, same rationale as the provider-picker decision above).

## Explicit scope cut

**Voice-driven perio entry** stays deferred, gated on the day-5 feasibility test. Not built now.
