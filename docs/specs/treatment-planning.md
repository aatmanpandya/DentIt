# Treatment planning (Day 18-19)

Decisions from grilling on 2026-08-22, before implementation. This is the spec the Day 18-19 build
works from — see `docs/specs/data-model.md`'s "Treatment planning" section for the
`treatment_plans`/`treatment_plan_phases`/`treatment_plan_items` schema (already in
`src/server/db/schema/treatment-plans.ts`, unimplemented beyond that), `docs/adr/0002-charted-procedure-single-source-of-truth.md`
for why items reference a Charted Procedure rather than copying its fields, `docs/specs/api-surface.md`'s
"Treatment planning" section for the already-spec'd endpoints, and `docs/specs/odontogram.md`'s
pricing-deferral section for the decision this spec resolves. Nothing in those documents is
re-litigated here except where explicitly noted as a resolution of an open conflict.

## Pricing: live until accepted, snapshotted at accept

Two existing docs disagreed going into this session. `odontogram.md` deliberately left
`charted_procedures.price` null at charting time — "entered manually later, at the invoicing
stage" — and flagged that as **provisional**, a product call to revisit if a live price preview
turned out to be wanted after all. But `data-model.md`'s schema comment already said `price` is a
"snapshot at acceptance," and `ui-design.md` requires a running total in the plan builder and a
priced presentation screen — neither possible without a real number well before invoicing. Checked
against the code: `updateProcedureStatus` (`chart.ts`) currently does nothing with price on any
transition including `accepted`, so the "snapshot at acceptance" comment wasn't actually
implemented before this spec.

**Resolution:**

- While a plan is `draft` or `presented`, every price shown (builder running total, presentation
  screen line items) is computed **live** via the existing `getPricing`/fee-schedule path
  (`src/server/services/catalog.ts`), on every read. Nothing is written to
  `charted_procedures.price` at this stage.
- **`POST /treatment-plans/:id/accept` is the moment price gets snapshotted** — for every item on
  the plan, `getPricing` is resolved one final time and the result is written to that item's
  `charted_procedure.price` and `.fee_schedule_id`, in the same transaction as the status
  transition below. This is what "snapshot at acceptance" in `data-model.md` meant, now actually
  implemented.
- If any item's procedure code has no price in the applicable fee schedule, `accept` fails
  atomically for the whole plan (`FEE_SCHEDULE_NO_PRICE`, the existing error `getPricing` already
  throws) — no partial accept. The presentation/builder screens should surface this ahead of time
  (a code with no price shows plainly as unpriced, not a blank), so hitting it at accept-time is
  the exception, not the common path.
- `odontogram.md`'s deferral is otherwise untouched: a procedure charted directly on the Odontogram
  and never put on a treatment plan still gets its price entered manually at invoicing, same as
  today. This spec only resolves the "provisional" flag by adding an accept-time snapshot path;
  `odontogram.md` has been updated with a pointer here.

## Building a plan: phases and items

**Revised after initial build — see "Adding a treatment without charting first" below.** The
original version of this section said items only ever reference procedures that already exist,
full stop. Real usage broke that: not every patient has an Odontogram entry before a plan gets
drafted (a quick walk-in consult, or simply a dentist who hasn't charted yet), and requiring one
first meant the picker showed nothing to add — or worse, encouraged charting-as-an-afterthought
just to unblock the plan. The rule below is what actually ships; the "no create path" framing is
kept struck through in spirit only insofar as the reference-only path (from an already-charted
procedure) is still the default and still the common case for a patient who's already been charted.

`POST /phases/:id/items { charted_procedure_id }` (per `api-surface.md`) still takes an existing
id — that path is unchanged. The item picker's "from chart" list still lists the patient's
`planned`-status charted procedures (from `GET /patients/:id/chart`). Adding an item this way still
validates the referenced procedure is `planned` and belongs to the same patient as the plan
(`TREATMENT_PLAN_ITEM_NOT_PLANNED`, 422, if not — the same "can't be used as an existence oracle for
another patient's data" discipline as the perio comparison fix: same error whether the procedure
doesn't exist, belongs to another patient, or isn't `planned`). What's new is a second path — see
below.

**A phase is mandatory.** `treatment_plan_items.treatment_plan_phase_id` is `NOT NULL` in schema —
there's no such thing as an unphased item. `POST /patients/:id/treatment-plans` auto-creates one
default phase ("Phase 1") in the same transaction as the plan, so the builder is never staring at
an item-drop target that doesn't exist yet. The user renames it or adds more phases from there.

**Drag-to-reorder covers both phases and items within a phase** — `ui-design.md`'s "phases, drag
to reorder" doesn't say which, and both need it (a phase's position affects presentation order, an
item's position affects it within the phase). Both carry their own `sequence` int already in
schema. `api-surface.md` didn't spec a reorder endpoint — **adding two now**: `PATCH /phases/:id
{ sequence }` and `PATCH /items/:id { sequence }`, each doing a simple renumber of siblings server
side (no client-computed sequence gaps). Documented as an addition to `api-surface.md` below.

**Running total**: per-phase subtotal and a plan-level total, both live-computed the same way as
per-line pricing above (sum of each item's live-priced procedure) — not stored, recomputed on every
read, consistent with CAL in `perio.md` being "computed, never stored."

## Adding a treatment without charting first

**Revision, made after the first build shipped and got used.** The original design (above) made
the plan builder strictly reference-only — items pointed at an existing `charted_procedure` and
nothing else. That's clean relative to ADR-0002, but it has a real workflow cost: a patient who
hasn't been through the Odontogram yet has nothing in the "from chart" picker, so a dentist who
just wants to jot down "root canal + crown, ₹15,000" for a quick consult is forced through a
charting detour first — or, worse, incentivized to chart something they haven't actually examined
yet just to unblock the plan. Not every patient needs a full chart before a treatment plan exists.

**Resolution: two ways to add a new (not-yet-existing) treatment, chosen explicitly per item.**
`POST /phases/:id/items` now also accepts `{ new_procedure: { procedure_code_id, tooth?, surfaces?,
quadrant?, arch?, chart_now } }` alongside the original `{ charted_procedure_id }` form.

**One picker, one click — not a separate "from chart" list gated behind its own "+ New treatment"
button.** The first version did split it that way; live use showed it was a wasted click every
time (`AddItemPicker`, `src/components/plans/add-item-picker.tsx`). `POST /phases/:id/items`
opens a single searchable list: this patient's `planned`-and-not-yet-on-this-plan procedures are
pinned at the top, each tagged **"Listed"**, and select in one click (the original reference-only
path — unchanged mechanically, just no longer behind an extra gate); the full procedure catalog
follows immediately beneath in its normal order (`ProcedureCodePicker`'s `pinned` prop,
`src/components/chart/procedure-code-picker.tsx`, both filtered by the same search box). Picking
any catalog code (not a "Listed" row) starts the scope step (tooth/surfaces/quadrant/arch as the
code requires) and then asks the one real question this flow exists for: **"Add this to the
Odontogram now, or just add it to the plan?"**

- **`chart_now: true`** — charts it immediately, same validation `chart.ts`'s `createProcedure` runs
  (scope match, tooth/surface validity), done inline in the same transaction rather than by calling
  that function directly (composing across two separate `dbForRequest` transactions would break
  atomicity — same reasoning as why `acceptTreatmentPlan` doesn't call `chart.ts`'s
  `updateProcedureStatus` either). Requires `odontogram` write **in addition to** `treatment_plans`
  write — charting is still charting, regardless of which screen it's driven from. An `admin` (who
  has `treatment_plans` write but not `odontogram` write, per the RBAC matrix) can't use this path.
- **`chart_now: false`** — defers charting entirely. The code/tooth/surfaces/quadrant/arch are
  copied onto the `treatment_plan_items` row itself (new nullable columns — see below) and
  `charted_procedure_id` stays null. Only needs `treatment_plans` write, since nothing clinical gets
  touched. The item shows a **"Not charted"** badge in the builder so this state is never silent.

**ADR-0002's invariant is preserved for anything that reaches real clinical commitment — deferred
charting is temporary, not a parallel source of truth.** A deferred item is promoted the moment its
plan is accepted: `acceptTreatmentPlan` now `LEFT JOIN`s `charted_procedures` (an `INNER JOIN`
before this change would have silently dropped deferred items from accept entirely) and, for any
item still unlinked, creates a real `charted_procedure` — already `accepted`, already priced, same
atomicity guarantee as every other item — then re-points the plan item at it and **clears the
item's own copied fields**, so post-accept there is exactly one place tooth/surfaces/code/price
live, exactly as ADR-0002 requires. A plan that's only ever drafted or declined never needs a
matching Odontogram entry at all — nothing was ever "the chart" for it, so there's nothing to keep
in sync.

**Schema**: `treatment_plan_items.charted_procedure_id` is now nullable, with four new nullable
columns (`procedure_code_id`, `tooth`, `surfaces`, `quadrant`, `arch`) used only when it's null. A
`CHECK` constraint enforces exactly one of `charted_procedure_id` / `procedure_code_id` is set at
all times — never both, never neither. See the schema file's own comment
(`src/server/db/schema/treatment-plans.ts`) for the exact invariant; docs/adr/0002 has a pointer to
this section.

**Pricing for a deferred item** works exactly like a linked one — live via `resolvePrice` while the
plan is `draft`/`presented`, using the item's own `procedure_code_id` instead of going through a
`charted_procedure`. `procedure_status` in the API response is `null` exactly when nothing's
charted yet; that's what the frontend keys the "Not charted" badge off, not a separate flag.

## Concurrent plans and procedure reuse

**No hard limit on concurrent `draft`/`presented` plans per patient** — useful for presenting a
budget option and an ideal option side by side. **A procedure can't end up on two plans past
acceptance**, but this isn't a special rule to build: it falls directly out of the pricing
resolution above. `POST /phases/:id/items` only accepts a `planned` procedure; the moment any plan
containing that procedure is accepted, the procedure itself moves to `accepted` (below), so a
second plan can no longer add it (`TREATMENT_PLAN_ITEM_NOT_PLANNED`). Nothing to enforce at the
plan level directly.

## Plan lifecycle and status transitions

```
draft ──present──> presented ──accept──> accepted ──(derived)──> completed
  │                    │
  └──────decline───────┴──> declined
```

| From | Legal manual transitions |
|---|---|
| `draft` | `presented` (via `/present`), `declined` (via `PATCH .. { to_status }`) |
| `presented` | `accepted` (via `/accept`), `declined` |
| `accepted` | none manual — `completed` is derived, below |
| `declined` | none |
| `completed` | none |

Illegal transition attempts: `TREATMENT_PLAN_ILLEGAL_TRANSITION`, 422 — same shape as
`PROCEDURE_ILLEGAL_TRANSITION`.

**`PATCH /treatment-plans/:id` does the same double duty `PATCH /procedures/:id` already does**
(`chart.ts`'s existing convention): a `to_status` body is a lifecycle transition (used for
`declined` — there's no dedicated `/decline` endpoint, matching `api-surface.md` not listing one),
anything else (currently just `name`) is a content edit. `/present` and `/accept` stay dedicated
endpoints because each carries side effects beyond a bare status flip (stamping `presented_at`;
snapshotting price and bulk-transitioning procedures on accept).

**Editable in `draft` and `presented`, locked from `accepted` onward** — a plan discussed chairside
gets tweaked live before the patient signs off, but once accepted it's a historical record, same
norm as an invoiced procedure under ADR-0002. Attempting to add/remove/reorder items or edit a
phase on an `accepted`, `declined`, or `completed` plan: `TREATMENT_PLAN_LOCKED`, 422.

**Presenting or accepting an empty plan is rejected**: `TREATMENT_PLAN_EMPTY`, 422 ("Add at least
one item before presenting this plan.") — a plan with no items has nothing to price or show a
patient.

**`/accept` also bulk-transitions every item's `charted_procedure` from `planned` to `accepted`**,
in the same transaction as the price snapshot — this is the one non-obvious side effect of
accepting a plan, and it's why accept is atomic-or-nothing. If any item's procedure has drifted out
of `planned` since it was added (e.g. cancelled directly from the Odontogram in the meantime), the
whole accept fails rather than partially succeeding — reuses `chart.ts`'s existing
`IllegalProcedureTransitionError` internally, surfaced as `TREATMENT_PLAN_ITEM_NOT_PLANNED` at the
plan level so the caller doesn't need to know which layer failed.

**`completed` is derived, not a manual transition.** The plan flips to `completed` automatically
the moment every one of its items' `charted_procedure` reaches `completed` — no cron; a check
added to `chart.ts`'s `completeProcedure`/`updateProcedureStatus` (when a procedure transitions to
`completed`, look up any treatment-plan item referencing it, and if every sibling item's procedure
is also `completed`, flip the parent plan). Matches how `perio_exams.complete` and `notes.sign`
both make a record's terminal state explicit rather than inferred at read time — future reads of
`treatment_plans.status` don't need to re-derive it by joining and checking every item.

**Declining needs no reason field** — consistent with `deleteProcedure` not requiring one either
(`perio.md` made the same call for un-completing an exam). If a decline reason turns out to matter
for the business, that's a real column to add later, not something to fake with a free-text hack
now.

## Signature capture

`POST /treatment-plans/:id/accept { signature_image? }` is already spec'd in `api-surface.md`, and
`treatment_plans.signature_image_key` already exists in schema. Read together with the pilot plan's
explicit cut of "e-signature": this is **informal consent capture** (the patient draws or the
screen captures a signature image at the moment of accepting, stored as a record that consent was
given in person) — not a cryptographically signed, audit-trailed, identity-verified e-signature
workflow. No separate signing ceremony, no certificate, no third-party signing service.

**Real gap found while grilling this**: there is no object-storage backend anywhere in this
codebase yet. `patient_documents.storage_key` exists in schema with the same shape
(`filename`/`mime_type`/`storage_key`) but no service reads or writes it — this would be greenfield
infrastructure, not reuse of something proven. Given the pilot's zero schedule slack and cloud-only
deployment, building a full object-storage integration (S3 or equivalent) for one signature image
is disproportionate. **`signature_image_key` holds the image directly, as a base64-encoded PNG data
URI, for the pilot** — not an external storage key despite the column name (the name is now
slightly stale; left as-is rather than a migration for a naming nit, but noted here so it isn't
mistaken for pointing at real object storage). Revisit if `patient_documents` ever gets a real
backing store — the two would naturally share it.

Captured only at accept, and immutable after — the plan locks at `accepted` (above), so there's no
path to overwrite a signature once given.

## Presentation view

**In-app, behind the same staff auth as everything else — not a public or portal link.**
`ui-design.md` calls it "the only screen a patient sees," which could be read as needing
unauthenticated access, but patient portal is explicitly cut from pilot scope in the pilot plan,
which rules that out. In practice: staff pulls the plan up on a tablet/desktop and hands it to the
patient, or prints it (the "clean, printable" requirement). No new auth mode, no shareable link.

Content is patient-facing only — treatment name (not procedure code), tooth/location where
relevant, phase grouping, per-line price, phase subtotals, plan total. No internal fields (fee
schedule name, provider margins, procedure codes) leak into this view. Accessible in `draft` and
`presented` (not just after accept) — the point is to walk the patient through pricing chairside
*before* they commit, per Q1's live-pricing resolution.

## What accepting does NOT do

**No auto-scheduling.** `LEGAL_PROCEDURE_TRANSITIONS` already requires a separate `accepted →
scheduled` step per procedure (`chart.ts`), and the pilot plan's Day 18-19 scope is phases, items,
pricing, and the presentation view only — scheduling integration isn't in it. Accept stops at
`accepted` on each procedure and `accepted_at` on the plan; scheduling the actual appointments
stays a manual step on the existing Schedule tab, unchanged by this feature.

## "Pricing via SelfPayAdapter"

The pilot plan's phrasing doesn't name a class that exists anywhere in this codebase — confirmed by
search. Read in context (the ADR table names `SelfPayAdapter` as the billing-adapter *category* in
use for this pilot, versus a future insurance/EDI adapter that doesn't exist yet), it means "price
via the cash-pay path," i.e. the existing `getPricing`/fee-schedule lookup. **No new adapter
interface gets built for this phase** — treatment planning calls `getPricing` directly, same as the
pricing route already does.

## RBAC

**No change needed** — `treatment_plans` is already a resource in `src/server/lib/permissions.ts`
and already matches `pilot-foundations.md §4`'s table exactly (owner/admin/provider/hygienist
write; front_desk/assistant/accountant read-only). Verify against `permissions.ts` before assuming
otherwise, same caveat `perio.md` gives.

## API surface — additions to `api-surface.md`

Everything in `api-surface.md`'s existing "Treatment planning" block is implemented as spec'd.
Two endpoints are new, needed for drag-to-reorder (above), and should be appended to that block:

```
PATCH  /phases/:id                            { sequence }  — reorder phases within a plan
PATCH  /items/:id                             { sequence }  — reorder items within a phase
```

## Error codes — additions to `validation-and-errors.md`

```
TREATMENT_PLAN_ILLEGAL_TRANSITION
TREATMENT_PLAN_LOCKED
TREATMENT_PLAN_EMPTY
TREATMENT_PLAN_ITEM_NOT_PLANNED
```

| Code | Message |
|---|---|
| `TREATMENT_PLAN_ILLEGAL_TRANSITION` | "This plan can't move from presented to draft directly." |
| `TREATMENT_PLAN_LOCKED` | "This plan has already been accepted and can't be edited." |
| `TREATMENT_PLAN_EMPTY` | "Add at least one item before presenting this plan." |
| `TREATMENT_PLAN_ITEM_NOT_PLANNED` | "This procedure is no longer available to add — it may already be on another plan or no longer planned." |

## Explicit scope cut

- **Auto-scheduling on accept** — deferred, above.
- **Legal e-signature** (audit trail, identity verification, certificates) — explicitly cut per the
  pilot plan; only informal signature-image capture is in scope.
- **Patient-portal / unauthenticated presentation link** — deferred with the rest of the patient
  portal, per the pilot plan's cut list.
- **Real object storage for the signature image** — base64-in-column for the pilot, above; not a
  scope cut so much as an explicitly deferred piece of infrastructure shared with the also-unbuilt
  `patient_documents` storage.
