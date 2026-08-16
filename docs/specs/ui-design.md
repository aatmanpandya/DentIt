# UI Design Direction and Screen Inventory

## The brief, stated

**Subject:** clinical software for small Indian dental clinics.
**Audience:** dentists, hygienists, assistants and receptionists — using it all day, under bright
operatory lighting, often with gloves on, frequently in a hurry.
**The app's single job:** move a clinician through dense clinical data quickly, without error.

The requirement is that this beat the incumbents on the user-facing side. That is a bar about
*density handled gracefully*, not about looking like a consumer app. Clinical software fails by
being ugly and slow, or by being pretty and sparse. The target is neither.

## Direction: instrument, not dashboard

The visual language comes from the instruments, not from SaaS. A periodontal probe is a slim steel
shaft with **black millimetre bands**. That banding — a measurement scale you read at a glance — is
the motif this interface is built from, and it happens to be exactly what the signature screen
needs to express.

**Explicitly rejected:** cream background with serif display and terracotta accent; near-black with
an acid accent; hairline-ruled broadsheet columns. Also rejected: the blue-gradient healthcare
template every competitor uses.

### Colour

```css
--paper:    #F8F9F8;   /* cool porcelain — dental cast, not cream */
--surface:  #FFFFFF;
--ink:      #101418;   /* radiograph shadow */
--ink-soft: #5A6570;
--steel:    #33556E;   /* instrument steel — the brand accent */
--steel-lo: #E8EDF1;
--rule:     #DDE1DE;
--band:     #0B0E11;   /* probe banding */
```

**Clinical status colours are reserved and must never be used decoratively:**

```css
--bleed:    #C1272D;   /* bleeding on probing, disease, critical alerts */
--caution:  #C77A0A;   /* watch, moderate pocket depth */
--healthy:  #2E7D5B;   /* healthy, completed, paid */
```

This reservation is the palette's organising rule. Red means bleeding. It does not mean "primary
button". That is why the brand accent is steel blue — it sits outside the clinical semantic range
and can never be confused with a finding.

**Light theme is primary.** Operatories are brightly lit, screens are read at an angle, and 2mm
numerals need maximum contrast. Dark theme ships later as a preference, not as the default. This
is a deliberate reversal of the fashionable choice, made for the room the software is used in.

Never encode clinical meaning in hue alone — bleeding shows as colour **and** a filled marker.
Operatory monitors are frequently terrible.

### Type

One superfamily across three roles. In clinical software, consistency is learnability, and a
display face fighting the data is noise.

| Role | Face | Use |
|---|---|---|
| Data | **IBM Plex Mono** | Every measurement, tooth number, price, time. Tabular figures, unambiguous 1/l/7 |
| Interface | **IBM Plex Sans** | Body, labels, controls |
| Structure | **IBM Plex Sans Condensed**, 600 | Section headers, column labels — condensed buys width back in dense grids |

Plex is drafted rather than styled — it reads as engineered, which is what an instrument should
read as. Self-hosted, no external requests.

Scale: 11 / 12 / 13 / 15 / 18 / 24 / 32. Body 13px, not 16 — this is a data tool, and 16px body
costs a visible row of patients on a 1366×768 clinic monitor.

### Density

- 4px base unit. Data rows 28px. Touch targets 40px minimum where a glove might land.
- Content is full-width. No centred max-width container — wasted horizontal space is wasted
  patients-per-screen.
- Borders over shadows. Shadow is reserved for genuinely floating things (menus, dialogs).
- Radius 3px throughout. Enough to not look brutal, not enough to look consumer.

## The signature: probe bands in the perio grid

Each perio cell shows the pocket depth **as a number and as a vertical band** — a miniature probe
reading rendered in the cell, band height proportional to depth, coloured by severity. A full-mouth
exam then reads as a landscape: shallow even bands across a healthy mouth, tall dark spikes where
disease is.

This is the one memorable element, and it is clinically load-bearing rather than decorative — it
answers "where is this mouth in trouble?" in a glance, which is the question the exam exists to
answer and which no competitor's grid of bare numbers answers at all.

Everything else in the interface stays quiet so this can be loud.

```
        16      15      14      13      12      11
      ┌──────┬──────┬──────┬──────┬──────┬──────┐
   MB │ ▎ 3  │ ▎ 2  │ ▎ 3  │ ▎ 2  │ ▎ 2  │ ▎ 3  │
    B │ ▎ 2  │ ▎ 2  │ ▎ 2  │ ▎ 1  │ ▎ 2  │ ▎ 2  │
   DB │ ▊ 5 ●│ ▍ 3  │ ▎ 3  │ ▎ 2  │ ▎ 2  │ ▎ 3  │
      └──────┴──────┴──────┴──────┴──────┴──────┘
        ● = bleeding      band height = depth
```

## Layout shell

```
┌────────────────────────────────────────────────────────────┐
│ ▪ Clinic ▾   Location ▾              search       user ▾   │  48px
├──────┬─────────────────────────────────────────────────────┤
│      │  Patient · 34 F · #P-0412        ⚠ Penicillin       │  patient bar
│ nav  │  ─────────────────────────────────────────────────  │  (chart only)
│ rail │                                                     │
│ 56px │  content, full width                                │
│      │                                                     │
└──────┴─────────────────────────────────────────────────────┘
```

Icon-only left rail with labels on hover — width is worth more than affordance here, and staff
learn six icons in a day. The patient bar is persistent in any patient context and carries alerts;
an allergy must never be more than a glance away.

## Screen inventory

Ordered by build day.

| Day | Screen | Notes |
|---|---|---|
| 1–3 | Login, accept invite, reset password | Single centred card. The only place the layout is generous |
| 3 | App shell, location switcher, user menu | |
| 4–5 | Patient list + search | Dense table, keyboard navigable, search focused on load |
| 4–5 | Patient chart shell | Tabbed: Chart · Perio · Notes · Plans · Ledger · Documents |
| 4–5 | Patient add/edit | Two columns. Only name and phone required |
| 6 | **Treatment catalog editor** | Spreadsheet-shaped. Inline edit, bulk save. First screen where the quality bar shows |
| 6 | Fee schedule editor | Same grid, price column, effective dates |
| 7–10 | **Day view** | Operatory columns × time rows. Drag to move and resize. The screen staff live in |
| 7–10 | Week view (per provider), month planner | |
| 7–10 | Appointment create/edit panel | Side panel, not a modal — the schedule must stay visible |
| 11–13 | **Odontogram** | SVG, adult + paediatric. Surface-level selection |
| 11–13 | Charting panel | Code picker, surfaces, status. Adjacent to the odontogram, never over it |
| 14–17 | **Perio grid** | The signature. Full-width, mouse and keyboard equal |
| 14–17 | Perio comparison | Prior exam delta, same grid, change highlighted |
| 18–19 | Treatment plan builder | Phases, drag to reorder, running total |
| 18–19 | Treatment plan presentation | Clean, printable, patient-facing. The only screen a patient sees — and the only one that may breathe |
| 20 | Invoice, payment, patient ledger | |

## Interaction rules

- **Keyboard parity everywhere.** Every action reachable without a mouse. `/` focuses search, `Esc`
  closes panels, arrows move grid cells.
- **No confirmation dialogs for reversible actions.** Undo toast instead. Confirm only for
  irreversible things: void invoice, sign note, delete patient.
- **Optimistic UI on clinical entry.** The perio grid and odontogram commit immediately and
  reconcile in the background; an operator with gloves on cannot wait on a spinner.
- **Side panels, not modals**, wherever context matters — which is nearly everywhere.
- Motion: 120ms, ease-out, for state changes only. No decorative animation. `prefers-reduced-motion`
  removes all of it. This is a tool people use 300 times a day; delight decays into friction fast.

## Quality floor

Keyboard focus always visible. Contrast AA minimum, AAA for measurements. Works at 1366×768 —
the realistic clinic monitor, not a designer's laptop. Never relies on hue alone. Self-hosted
fonts. No layout shift on load.

## Voice

Plain, direct, sentence case. Name things as clinicians do — "gum measurements" not "periodontal
assessment data", "treatments" not "procedure codes" where a clinician reads it. Buttons say what
happens: "Save exam", not "Submit". An action keeps its name through the whole flow.
