# Bug log

Every real bug hit while finishing the pilot, written when it happened. Newest last.
Format: symptom, how it was noticed, what didn't work, root cause, fix, commit.

---

## 1. CI typecheck fails on `LayoutProps`, passes locally

- **Symptom:** the first push of `main` (`6be1939`) failed GitHub Actions at `npm run typecheck`:
  `src/app/layout.tsx(31,50): error TS2304: Cannot find name 'LayoutProps'`. Locally
  `npm run typecheck` was clean and all 440 tests passed.
- **How noticed:** `gh run list` showed the run red; the failing step was typecheck, before
  lint and tests ran.
- **What didn't work:** nothing was tried blind. Running `tsc --noEmit` again locally just
  passed again, which is what pointed at environment rather than code.
- **Root cause:** `LayoutProps` / `PageProps` / `RouteContext` are global types that Next 16
  generates into `.next/types/` during `next dev`, `next build` or `next typegen`
  (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`). This
  machine has a `.next/` left over from running the dev server; a fresh CI checkout doesn't,
  and `.next/` is gitignored. So the code depended on an artifact of having run the app once.
- **Reproduced:** cloned the repo into a scratch directory (no `.next/`), ran `tsc --noEmit`:
  same TS2304. Ran `next typegen` then `tsc --noEmit`: clean.
- **Fix:** `"typecheck": "next typegen && tsc --noEmit"` in `package.json`, so the types are
  always generated before checking, locally and in CI, with no workflow change.
- **Commit:** `849987a`

---

## 2. Schedule opens on the wrong clinic, so "today" looks empty

- **Symptom:** after re-seeding (so appointments land on today), `/schedule` still showed an
  empty day. The database had 10 appointments today.
- **How noticed:** browser walk. The network tab showed
  `GET /api/v1/appointments?location_id=25aa…&date=2026-11-12 → 200` with nothing in it; a
  query showed `25aa…` is **Baner**, while all 10 of today's appointments are at **Koregaon
  Park**. So the handoff's "schedule is empty" had two causes: stale seed dates (fixed by
  re-seeding; the seed was already relative to today) and this.
- **Root cause:** the pilot schedule is single-location by design and takes
  `listLocations()[0]`, commented as "the org's first active location". `listLocations`
  sorted by **name**, so the branch "Baner" outranked the main site "Koregaon Park".
- **What didn't work:** first fix ordered by `locations.createdAt`. Every test in the file
  then failed with `PostgresError: syntax error at or near "asc"`. `locations` is one of the
  few tables not built with `tenantColumns()` and has no `created_at`; Vitest doesn't
  type-check, so `locations.createdAt` was `undefined` and drizzle emitted a bare `asc`.
  `created_at` would have been the wrong fix anyway: adding it to existing rows gives them
  all one timestamp, the tie falls back to name, and Baner wins again.
- **Fix:** `locations.display_order` (migration `0008`), the same pattern `operatories`
  already uses; `listLocations` orders by `display_order, name`; seed sets it from
  mock-data order, so the first entry is the main site. Test: "orders locations by display
  order, not alphabetically" (failed before, passes after). Existing databases get 0 for
  every location until re-seeded or set.
- **Commit:** `e27346f`

---

## 3. Accepted procedures can never be completed, so nothing can ever be invoiced

- **Symptom:** walking the treatment-plan lifecycle, after accepting a plan the tooth chart's
  History for tooth 16 showed only "Accepted" with a **Cancel** button. No way to mark the
  work done, so the plan could never reach `completed` and no procedure could reach
  `invoiced`, which blocks all of Phase 2.
- **How noticed:** browser walk, Chart tab after accept. The `procedures/[id]/complete` route
  existed, so the button's absence was suspicious.
- **Root cause:** `LEGAL_PROCEDURE_TRANSITIONS` (`chart.ts`) is
  `planned → accepted → scheduled → completed`, and the panel only shows **Complete** for
  `scheduled`. Nothing anywhere moves a procedure to `scheduled`: appointments can't be linked
  to procedures (grepped `appointments.ts` / the appointment panel, nothing).
  `treatment-planning.md` says scheduling "stays a manual step on the existing Schedule tab",
  but that step was never built. A lifecycle with an unreachable state. Directly-charted
  work (`planned`, never on a plan) had the same dead end, though `odontogram.md` expects it
  to complete and be priced at invoicing.
- **Why tests didn't catch it:** the service test walks the lifecycle by calling
  `updateProcedureStatus(…, "scheduled")` directly, a step no user can take.
- **Decision (owner, 12 Nov):** complete from the chart. `scheduled` becomes optional:
  `planned → completed` and `accepted → completed` are legal; the chart shows **Complete** for
  planned, accepted and scheduled. Linking appointments to procedures is left for later.
- **Also fixed:** History rows said only the status ("Accepted"); they now name the procedure
  ("Zirconia crown · Accepted").
- **Verified:** test "completes directly from planned or accepted" (failed before with
  `Can't move from planned to completed`, passes after). In the browser: completed the three
  procedures on Arjun Kulkarni's accepted plan from the chart; the plan flipped to Completed.
- **Commit:** `f9aea35`

---

## 4. One click on "Decline" permanently kills a plan

- **Symptom:** "Decline" sits next to "Accept" and acts on one click. `declined` has no
  outgoing transitions, so a misclick loses the plan for good: no confirm, no undo.
- **How noticed:** browser walk, declining a second plan. Checked `ui-design.md`: "Confirm
  only for irreversible things", so this breaks the project's own rule.
- **Fix:** inline confirm (same pattern as the accept panel, not a modal): "Declining is
  final … Its charted procedures stay on the chart as planned." with **Decline plan** /
  **Keep plan**. While building it, found that an open accept or decline panel would survive
  switching plans in the sidebar and then act on the *newly selected* plan; both panels now
  close on plan switch, and opening one closes the other.
- **Also fixed (same walk, minor):** the plan builder's "+ Add item" picker didn't focus its
  search box, so typing went into whatever field had focus last (it landed in "Plan name").
  `ProcedureCodePicker` takes an opt-in `autoFocus`; only the plan builder uses it.
- **Verified in browser:** confirm appears; switching plans closes it; "Decline plan"
  declines; typing after "+ Add item" lands in search.
- **Commit:** `94e9da6`

---

## 5. Unpriced items show as a dash, and accept fails only after the patient signs

- **Symptom:** a plan item whose code has no fee-schedule price showed "—" for its price,
  its phase subtotal and the plan total; the accept prompt read "see **Total —** below". The
  patient could sign, press Confirm, and only then get "No price is set for this procedure
  yet.", which doesn't say *which* procedure.
- **How noticed:** browser walk of the unpriced path: added catalogue code `INLAY-CER` with no
  price, put it on a plan for Meenakshi Iyer, presented, tried to accept.
- **What was already right:** the server refuses cleanly (`FEE_SCHEDULE_NO_PRICE`, 422,
  nothing partially applied), and the serializer deliberately returns `null` for any total
  containing an unpriced item rather than a misleading partial sum. Both kept.
- **Root cause:** UI only. The builder's `money()` rendered `null` as "—", which
  `treatment-planning.md` rules out ("shows plainly as unpriced, not a blank"). The
  presentation page already said "Not yet priced".
- **Fix:** builder shows "Unpriced" per item and subtotal, "Total: N items unpriced" for the
  plan. The accept panel names the unpriced items, links to Settings → Fee schedule, and
  disables Confirm, so the patient never signs a plan that can't be accepted.
