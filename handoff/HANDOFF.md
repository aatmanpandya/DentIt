# Odontogram — implementation handoff

Two files, no dependencies beyond React. Hand this document and the two files to the coding agent.

## Integration status (2026-08-17) — done

`odontogram-teeth.ts` is copied verbatim into `src/components/chart/odontogram-teeth.ts` and is
now the app's sole tooth-geometry source (see `docs/specs/odontogram.md`'s "Tooth geometry"
section for the full writeup). Per task 4 below, `Odontogram.tsx`'s own component and state model
(`Chart`, `CONDITIONS`, controlled/uncontrolled `value`/`onChange`, the toolbar) were **not**
adopted — this app already has a service-backed chart data model
(`src/server/services/chart.ts`, conditions/procedures with a real lifecycle, RLS, ADR-0002
supersede-on-amend) that predates this handoff and that CLAUDE.md requires all business logic to
live in. Only the geometry primitives were reused:

- `toothGeometry(fdi)` → the app's `ToothImage` (`tooth-image.tsx`), which clips the one closed
  outline at `cervicalY` for a tan-root/white-crown two-tone the app's own reference screenshots
  called for, and layers the app's own whole-tooth overlay states (ghosted/struck/ring/
  root-line-icon) on top.
- `surfaceWedges({ side, anterior })` → the app's `ToothOutline` (`tooth-outline.tsx`), which
  keeps this app's own condition-fill / procedure-stroke layering but drops the reference
  `SurfaceWheel`'s inline styling in favor of the app's design tokens (`var(--bleed)` etc.).
- `isAnterior(fdi)` → `tooth-shapes.ts`'s `validSurfacesForFdi`, the client-side mirror of the
  server's `validSurfacesForTooth`.

`Odontogram.tsx` itself (this folder's second file) was not copied into the component tree —
its `ArchRow`/`ToothCell`/`SurfaceWheel` layout was the reference for the app's own
`odontogram.tsx`'s 4-row grid (image/wheel/wheel/image, sandwiched at the midline), but the app's
grid drives off `computeAllToothStates()` and `useRovingTabindex()`, not this file's `Chart`
object or click handlers.

Acceptance checks re-verified against this integration, live, via Playwright + the seed dataset:
32 permanent silhouettes with distinct root counts (1/2/3) and crown shapes; the `Primary` toggle
force-renders 20 primary-position silhouettes; wedge clicks paint condition fills; `missing`
renders ghosted + struck; no console warnings about SVG attribute casing. Not re-verified because
this app doesn't have an equivalent concept: `readOnly`/toolbar visibility (this app's toolbar is
the separate charting panel, opened per-tooth, not a persisted condition picker on the grid
itself).

## Files

| File | What it is |
| --- | --- |
| `odontogram-teeth.ts` | Pure geometry. Generates all 32 permanent and 20 deciduous tooth silhouettes from parametric control points, plus the five-surface wheel and the arch layout. No React, no DOM, no assets. |
| `Odontogram.tsx` | The chart component. Client component, controlled or uncontrolled, inline-styled via a `theme` prop. |

## Task list for the agent

1. Copy both files into the component tree, keeping them siblings — `Odontogram.tsx` imports `./odontogram-teeth`. Suggested location: `components/odontogram/`.
2. If the project is JavaScript rather than TypeScript, strip the type annotations; nothing else changes.
3. Mount it on a page and confirm the acceptance checks below.
4. Wire `value` / `onChange` to wherever chart state lives (server action, React Query mutation, form state). Do not add persistence inside the component.
5. Only then adapt styling: either pass a `theme` or replace the inline `style` objects with the project's `className` convention. Keep the SVG geometry attributes untouched.

## Usage

```tsx
'use client';
import { useState } from 'react';
import { Odontogram, chartToFindings, type Chart } from '@/components/odontogram/Odontogram';

export default function ChartPage() {
  const [chart, setChart] = useState<Chart>({});
  return (
    <>
      <Odontogram value={chart} onChange={setChart} dentition="permanent" />
      <pre>{JSON.stringify(chartToFindings(chart), null, 2)}</pre>
    </>
  );
}
```

## State shape

Keyed by FDI number, so it serialises straight to an API:

```ts
{
  "16": { whole: "crown", surfaces: { O: "caries", M: "filling" } },
  "24": { surfaces: { B: "caries" } },
  "38": { whole: "missing" }
}
```

Surface codes: `B` buccal, `L` lingual, `M` mesial, `D` distal, `O` occlusal (posteriors), `I` incisal (anteriors). Mesial is resolved per tooth against the midline, so the same code means the correct physical surface on both sides of the arch.

`chartToFindings(chart)` flattens that into `{ fdi, scope: 'tooth' | 'surface', surface?, surfaceName?, condition }[]` for a findings list, a diff, or a POST body.

## Component props

| Prop | Type | Notes |
| --- | --- | --- |
| `value` / `onChange` | `Chart` / `(next: Chart) => void` | Controlled mode. Omit `value` to run uncontrolled from `defaultValue`. |
| `condition` / `onConditionChange` | `string` / `(key: string) => void` | The condition a click applies. Uncontrolled if both are omitted. |
| `conditions` | `Condition[]` | Defaults to caries, filling, crown, implant, missing. Each entry is `{ key, label, color, toothFill?, ghost? }`. `ghost` fades the silhouette and crosses it out — that is how missing renders. |
| `dentition` | `'permanent' \| 'primary' \| 'mixed'` | `mixed` stacks the deciduous arches inside the permanent ones. |
| `readOnly` | `boolean` | Hides the toolbar and disables marking. Use for the patient view. |
| `onSelectTooth` | `(fdi, geometry) => void` | Fires on every tooth click, including in `readOnly`. Use it to open a detail panel. |
| `theme` | `Partial<Theme>` | `{ ink, paper, surface, enamel, accent, mono }`. |

Clicking a wedge toggles that surface; clicking the tooth toggles the whole-tooth finding. Clicking with the same condition already set clears it.

## Geometry API

```ts
const t = toothGeometry(16);
// t.d             closed cubic-Bezier outline
// t.cej           cervical line
// t.transform     mirror + arch flip, already composed — apply to a <g>
// t.viewBox       '0 0 132 268', shared by every tooth
// t.controlPoints the spline ring, if you want to edit or animate the shape
// t.arch 'upper' | t.side 'right' | t.dentition 'permanent' | t.rootCount 3 | t.name 'first molar'
```

Other exports: `TOOTH_PATHS` (baked `{ 18: 'M…' }` map for static SVG), `ALL_TEETH`, `ALL_PRIMARY_TEETH`, `surfaceWedges({ side, anterior })`, `archLayout('upper')` for an occlusal plan, `isAnterior(fdi)`, `SURFACE_NAMES`, `catmullRomPath()`.

All teeth are drawn in one box with the cervical line at `y = 154`, x centred on 0, crowns growing `+y` and roots `-y`. `transform` handles the left/right mirror and the upper/lower flip, so a row of teeth needs no per-tooth positioning.

## Tuning the shapes

`SPEC` holds one entry per tooth type: `cw` crown width, `nw` neck width, `ch` crown height, `rl` root length, `n` root count, `furc` furcation depth, `spread` apex spread, `bow` single-root curvature, `boxy` posterior flank profile, `occ` the occlusal profile name. Change a number and every affected outline regenerates. Do not hand-edit path strings.

## Acceptance checks

1. 32 silhouettes render in permanent mode: upper `18→11 | 21→28`, lower `48→41 | 31→38`, quadrant divider on the midline.
2. `dentition="primary"` renders 20 teeth, `55→51 | 61→65` and `85→81 | 71→75`.
3. Each tooth carries a five-part wheel: four ring wedges plus a centre disc.
4. Clicking a wedge fills it with the active condition colour; clicking again clears it.
5. Clicking a tooth washes the whole silhouette; `missing` fades it and crosses it out.
6. `readOnly` hides the toolbar and makes clicks inert apart from `onSelectTooth`.
7. No console warnings about SVG attribute casing — the component uses `viewBox`, `strokeWidth`, `fillOpacity`, `strokeLinejoin`.

## Out of scope

Persistence, undo history, perio depths, bridges spanning teeth, notation other than FDI. The state shape leaves room for all of them: add keys to `ToothChartEntry` rather than changing the geometry.
