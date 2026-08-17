# Odontogram (Day 11-13)

Decisions from grilling on 2026-08-17, before implementation. This is the spec the Day 11-13
build works from — see `docs/specs/ui-design.md` for the one-line screen-inventory entry this
expands, `docs/specs/data-model.md` for `charted_conditions`/`charted_procedures`, and
`docs/specs/api-surface.md` for the already-spec'd chart endpoints.

## Interaction model

**Noun-first.** Click a tooth (or a surface on a tooth) → the charting panel opens scoped to
that selection → the user picks a condition type or procedure code inside the panel. This
matches how an exam actually proceeds — finding issues tooth by tooth — and is the dominant
pattern in Dentrix/OpenDental/Eaglesoft. A verb-first "paint mode" (pick a code first, then
stamp it across teeth) is a reasonable future addition for rapid repeat-charting; not built now.

## Tooth geometry

**Two components, one geometry source, split by job — not one shape trying to do both:**

- **`ToothImage`** (`src/components/chart/tooth-image.tsx`) — decorative, non-interactive
  anatomical silhouette. Tells one tooth apart from another (single/forked/tri-rooted, pointed vs
  flat crown). Not part of the roving-tabindex grid; carries whole-tooth overlay state
  (ghosted/struck/ring/root-line-icon, layer 3 below).
- **`ToothOutline`** (`src/components/chart/tooth-outline.tsx`) — the functional surface-selector
  wheel: five radial sectors (buccal/lingual/mesial/distal + occlusal-or-incisal center), keyboard-
  and click-interactive, identical structure for every tooth. Carries condition fill (layer 1) and
  procedure stroke (layer 2, below).

Arch layout sandwiches the two wheel rows between the two image rows, one pair per arch — image
row, wheel row, midline gap, wheel row, image row — modelled on a reference odontogram the user
supplied: tooth-image row tells teeth apart, the plain wheel row below it is where surfaces are
actually clicked. Standard mirrored ordering (18→11 | 21→28 on top, 48→41 | 31→38 on bottom).

**Geometry source: `src/components/chart/odontogram-teeth.ts`**, a parametric silhouette generator
(control-point ring + closed Catmull-Rom spline → cubic Bezier), not hand-authored path strings —
handed off complete by the user on 2026-08-17 and dropped in via `handoff/HANDOFF.md`. One
`ToothSpec` per tooth type (crown/neck width, crown height, root length, root count, furcation
depth) drives every permanent and deciduous tooth's outline; `toothGeometry(fdi)` returns the
closed outline (`d`), the cervical line (`cej`), and a composed mirror+arch-flip `transform` — side
(mesial resolution) and arch (crown-orientation) are already baked in, so neither consuming
component does its own orientation math. `ToothImage` splits that one closed outline into a tan
root / white crown two-tone by clipping at the cervical line (`g.cervicalY`), rather than the
geometry source providing two separate paths. Primary vs. permanent sizing needs no separate
scale-down step — `SPEC`'s smaller `cw`/`ch`/`rl` values for deciduous teeth already draw them
smaller within the same shared box.

This replaced two earlier, rejected attempts, in order: (1) one anatomically-shaped outline per
tooth type doubling as the click target — illegible at real grid density (32 teeth on screen); (2)
a uniform windowpane square, functional but made every tooth look identical — impossible to tell
which tooth was which at a glance. The image/wheel split resolved both failure modes at once: the
wheel stays simple and uniform (good for clicking), the image carries all the anatomical detail
(good for telling teeth apart) without needing to also be clickable.

## Color / marker system

Three layers can be present on one tooth simultaneously; each gets its own visual channel so
they don't collide, and none relies on hue alone (quality floor in `ui-design.md`):

1. **Condition** (finding) — icon/pattern on the relevant surface region, colored from the
   reserved clinical palette only where it genuinely fits: caries → filled `--bleed` red
   (disease), fracture → `--caution` amber, impacted/unerupted → diagonal hatch.
2. **Procedure status** — workflow, not clinical severity, so it must **not** use the reserved
   clinical colors (green="healthy" colliding with "invoiced" would be confusing). Steel-family
   outline treatment instead: `planned` = dashed steel outline, `accepted`/`scheduled` = solid
   steel outline, `completed` = solid steel fill, `invoiced` = solid steel fill + small receipt
   glyph. `cancelled` doesn't render on the glyph (see "current state only", below).
3. **Whole-tooth state** — a distinct whole-tooth overlay, separate from surface marks: missing →
   ghosted + diagonal strike (below), existing crown → heavier doubled outline ring around the
   whole tooth, existing RCT → small root-line icon on the root.

**Tooth-scoped procedures** (`applies_to: tooth` — extraction, crown prep, implant — no
`surfaces`, so no surface region to render on) reuse the whole-tooth ring position from layer 3,
but drawn with the steel procedure-status treatment (dashed/solid/filled) rather than the
historical-fact doubled ring. If a tooth has both an existing-crown condition and a newly planned
crown-replacement procedure, the two rings stack — accepted as a rare edge case rather than
designed around.

## Missing teeth

Ghosted silhouette (~30% opacity) in its normal arch position — not a collapsed gap, which would
misalign every subsequent tooth in the fixed layout — plus an explicit diagonal strike-through
(never opacity alone). Still fully clickable: opens the same panel, where the `missing` condition
can be resolved or a new procedure (implant, bridge abutment) charted directly onto the socket.

## Charting panel

Header: selected tooth (rendered per the org's FDI/Universal preference) with selected surfaces
highlighted. Two separate pickers below — condition-type and procedure code are different
objects with different vocabularies, not a unified search:

- **Condition-type picker** for findings.
- **Procedure code search**, filtered to `applies_to ∈ {tooth, surface}`, with surface toggles
  constrained live by `validSurfacesForTooth()` for the selected tooth.

Below both, a compact **History** section: existing conditions/procedures for that tooth, status
badges per the marker scheme above, inline actions (cancel a planned procedure, mark complete,
resolve a condition).

**Save model: panel-submit**, not per-toggle. Charting is a compound object (code + tooth +
surfaces + note) that isn't meaningful half-entered — unlike the perio grid's one-number-per-cell
shape, which does fire per-cell. Hitting save closes the panel and paints the tooth immediately
(optimistic), reconciling in the background — no spinner.

**No confirmation dialog on save.** Per `ui-design.md`'s interaction rules ("no confirmation
dialogs for reversible actions — undo toast instead"), saving shows an undo toast; one click
removes the just-created row while it's still `planned` (`DELETE /procedures/:id` is planned-only
per `api-surface.md`). The odontogram doesn't get a special exception to this rule.

**Provider**: defaults to the current logged-in user if they have a `provider_profiles` row,
otherwise left selectable — covers an assistant charting mid-exam on a provider's behalf.

**Price: deferred, not shown in this panel.** `charted_procedures.price` is left null at charting
time. Price is entered manually later, at the invoicing stage, once the procedure is marked
`completed` — not derived or previewed from the fee schedule here. **This is provisional**: if a
live price preview (via the already-spec'd `GET /pricing`) turns out to be wanted after all,
that's a product call to revisit explicitly, not something to build ahead of being asked for.

## Mouth / arch / quadrant-scoped procedures

The odontogram SVG is purely for `tooth`/`surface`-scoped codes — no quadrant/arch clickable
chrome invented for the rare codes that don't have a single tooth target. A separate, small list
module elsewhere on the Chart tab handles `applies_to: mouth | arch | quadrant` codes, reusing
the same charting-panel component (code picker) minus the tooth/surface step. **The full-mouth
option must stay prominently visible** in that list — not buried.

## Layout in the Chart tab

`src/app/(app)/patients/[id]/page.tsx` is currently `grid-cols-3`: demographics spans 2 columns,
Alerts takes the 3rd. That doesn't fit an odontogram + a permanently-adjacent panel.

The panel's column is **reserved permanently** — present with an empty/prompt state ("Select a
tooth to chart") when nothing's selected, not something that slides in over other content. This
is the literal reading of `ui-design.md`'s "adjacent to the odontogram, never over it," and
matches the persistent-side-panel precedent already built for the day/week schedule views.

To make room for a 32-tooth SVG mouth at real size, demographics collapses to a thin header strip
above the odontogram rather than keeping its own column. The Chart tab's separate Alerts list can
de-prioritize accordingly — active alerts already surface inline in the persistent patient bar
(`layout.tsx`, visible on every tab), so the Chart tab isn't the only place they're seen.

## Keyboard navigation

Roving-tabindex grid pattern, consistent with the day/week schedule grid already built — one
tabbable element (the selected tooth) at a time, arrows move both selection and focus within the
grid, `Tab` exits it entirely.

| Key | Action |
|---|---|
| `Tab` (from outside) | Enters the grid, focus on the last-selected tooth (default: upper-right 1st molar) |
| `←` / `→` | Adjacent tooth, same row — crosses the midline seamlessly (11 → 21). No wraparound at arch ends. |
| `↑` / `↓` | Same-position tooth, other arch (upper ↔ lower). No wraparound at row edges. |
| `Enter` / `Space` | Opens the charting panel for the selected tooth — no surfaces pre-selected |
| `Esc` | Closes the panel, focus returns to the tooth |
| `Tab` (inside panel) | Standard order: condition/procedure search → surface toggles → History actions → Save |
| `Tab` (from grid, no `Enter`) | Exits the grid to the next focusable element on the page |

Surface-level selection happens **inside the panel** via toggle controls (`Tab` + `Space`), not
via a second keyboard mode for sub-tooth regions on the SVG — full parity with mouse (every state
reachable) without needing 5-6-way navigation per tooth.

## Current state vs history, and the read contract

The glyph shows **current state only**: latest active condition + any non-cancelled/
non-superseded procedure + whole-tooth state. Full history lives in the charting panel's History
section (above), not layered onto the glyph itself.

Read contract: a shared service function — `getToothState(patientId, tooth)` in
`src/server/services/` — computed once and used by both the Odontogram and Perio (Day 14-17).
Perio does not reverse-engineer chart state from a bespoke summary object; it calls the same
service the chart does. This is the "one rule that must not erode" from `CLAUDE.md` applied
directly: business logic (what counts as a tooth's current state) lives in the service layer.

## Existing restorations at intake

Pre-existing crowns, root canals, and other historical work (not planned/billed by this system)
are `charted_conditions`, not `charted_procedures` — `charted_procedures` carries a real billing
lifecycle (price, fee_schedule_id, invoiced_at) that doesn't fit "this crown already existed
before this patient's record started here." New `condition_type` values: `existing_crown`,
`existing_rct`, `existing_restoration`.

## Mixed / adult / primary dentition

One chart, backed by mixed-dentition-aware data, with a three-way view toggle. No new table —
extends `charted_conditions.condition_type` (already free text) with two more values:
`unerupted` (permanent tooth not yet present — normal) and `exfoliated` (primary tooth naturally
gone — normal). `missing` stays reserved for pathological/extracted loss.

**Per-socket render rule** (32 canonical positions, each mapping to one primary + one permanent
FDI code): show the primary tooth unless it has an active `exfoliated`/`missing` condition, in
which case show the permanent tooth unless *it* has an active `unerupted` condition, in which
case render an empty socket.

**Intake defaults**: seed `unerupted` on all permanent teeth for patients under a configurable
age threshold (~13). The dentist corrects per-tooth as eruption actually happens — no separate
"mark erupted" flow; charting/clearing state on the tooth is the correction mechanism.

**View toggle**:
- `Mixed` — the computed accurate per-socket view above. Default for patients under the age
  threshold.
- `Adult` — force-render all 32 permanent positions regardless of markers. Lets a dentist
  plan/chart on a not-yet-erupted tooth ahead of time; default (and effectively only relevant
  mode) for adult patients.
- `Primary` — force-render all 20 primary positions regardless of markers. For
  reviewing/charting historical primary-tooth record even post-eruption.

Clicking a tooth in a forced view works identically to normal.

## Handoff to Perio (Day 14-17)

Decided now so the Perio build doesn't have to re-derive it:

- **Missing → auto-skip.** A tooth marked `missing` (via `getToothState()`) auto-seeds
  `perio_tooth_records.is_skipped: true` when a new exam is created — overridable per-tooth.
  Matches the documented OpenDental convention (grey column, auto-skip, manually re-enterable);
  reuses the `is_skipped` field this codebase already has.
- **Crown/implant → informational only.** Rides along as a label annotation on the perio grid's
  tooth header. Does not change which sites are probed or how — no source found where crown
  status affects perio entry.
- **Furcation unaffected.** `hasFurcation()` (molars + upper 1st premolars) is unaffected by
  crown status — confirmed as the standard external convention, not just this codebase's rule.
- **Primary teeth → auto-skip by default, overridable.** Per AAPD guidance, routine full
  pocket-depth probing on primary teeth isn't standard practice until first permanent
  molars/incisors erupt (or earlier only with clinical/radiographic reason). Perio exams for
  mixed/primary-dentition patients default primary-tooth columns to `is_skipped: true`; the
  dentist un-skips a specific tooth when there's a clinical reason to probe it. Kept consistent
  with the missing-tooth mechanism above rather than introducing a second, manual-only rule for
  a different tooth situation.
