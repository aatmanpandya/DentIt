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
- **Commit:** `0e9c954`

---

## 6. Declined plans show every item as unpriced

- **Symptom:** on the new `/plans` list, Sunita Deshmukh's declined "Lower denture" showed
  "1 unpriced" although complete dentures are ₹18,000 in the fee schedule.
- **How noticed:** browser check of `/plans` after seeding a plan in every status.
- **Root cause:** `resolveItemPrice` (`treatment-plans.ts`) read the accept-time snapshot for
  *any* status that isn't editable (`draft`/`presented`). `declined` isn't editable, but a
  declined plan never went through accept, so there is no snapshot: every price came back
  `null`. This predates `/plans`; the patient's own Plans tab showed the same "Unpriced" for
  declined plans. Earlier hand-declined plans in the walk had no items, so ₹0.00 hid it.
- **Fix:** read the snapshot only for `accepted`/`completed` (the statuses accept produces);
  everything else, `declined` included, prices live.
- **Test:** "prices a declined plan live, since it was never snapshotted" (failed with
  `expected [ null ] to deeply equal [ '500.00' ]`, passes after).
- **Commit:** `ef31e7f`

---

## 7. A payment recorded after an invoice sorted before it in the ledger

- **Symptom:** `ledger.test.ts` "takes a part payment and computes the balance" failed in a
  full run (`expected [ …(2) ] to deeply equal [ Array(2) ]`, the entry order) but passed
  when run on its own, three times in a row.
- **How noticed:** first full run of the new ledger tests. Passing alone and failing in a
  batch pointed at timing, not arithmetic.
- **Root cause:** two clocks. `invoices.issued_at` was set from Node (`new Date()`) while
  `payments.received_at` and `adjustments.created_at` used the column default, Postgres
  `now()`. The ledger sorts events across those tables by those timestamps. Sampling both
  clocks back to back showed the Docker VM's database clock a few milliseconds behind the
  host: on one sample the database read 4 ms *earlier* even though it was queried after
  Node. A payment recorded milliseconds after an invoice could therefore get an earlier
  timestamp and sort first.
- **What didn't work:** nothing was changed blind; re-running alone just passed, which is
  what showed it was order-dependent.
- **Fix:** every ledger event timestamp comes from the app clock: `received_at` and the
  adjustment's `created_at` are set explicitly in the service, never left to the DB default.
  Same-instant ties sort charges before payments. 21/21 across three consecutive runs after.
- **Commit:** `0972894`

---

## 8. Seeded invoices bill procedures the chart still shows as un-invoiced

- **Symptom:** `INV-0882` bills Rohan Shetty's filling on 14 and `INV-0883` Meenakshi Iyer's
  gum assessment, but both procedures were seeded as `completed`, and the invoice lines had no
  `charted_procedure_id`. With the ledger built, both would appear in "Create invoice" again:
  the demo could bill the same work twice, and voiding a seeded invoice couldn't find its
  procedures.
- **How noticed:** reading the seed's invoice block before building the ledger UI, to check
  the void rule ("procedures go back to completed") would work on seeded data.
- **Root cause:** the seed predates the ledger; it wrote invoice rows directly with a bare
  procedure *code* per line and float maths (`parseFloat`, against the no-floats rule).
- **Fix:** invoice lines reference seeded procedures by `key`; those procedures are seeded
  `invoiced` with `invoiced_at`; amounts go through `money.ts`/`lineTax`; numbers use the
  current year; `invoice_number_counters` starts after the highest seeded number.
- **Commit:** `979fcfe`

---

## 9. The patient header balance and the Ledger tab would disagree

- **Symptom:** none visible yet: caught before the Ledger UI shipped. `getPatientSummary`
  (the patient header) computed its own balance: issued invoice totals minus allocations to
  them, subtracted as JavaScript `Number`s. It ignored adjustments and any unallocated
  payment, so a patient who overpaid or got a discount would show one balance in the header
  and another on the Ledger tab.
- **How noticed:** before replacing the Ledger tab placeholder, checked where its existing
  "Balance" figure came from.
- **Test first:** extended the summary test with a ₹100 unallocated payment and a ₹50
  discount; it failed with `expected '600.00' to be '450.00'`.
- **Fix:** one balance calculation. `computeLedgerState` and `loadPatientLedgerRows` moved
  to `services/ledger-balance.ts` (separate from `ledger.ts` to avoid a patients ↔ ledger
  import cycle); the summary, the Ledger tab and the org ledger all use it, in paise.
- **Commit:** `eaf7c5a`

---

Entries 10 onward came from a code review on 12 Nov: six read-only agents each swept one area,
and every finding listed here was re-checked against the code before it was fixed.

## 10. A plan never completes if one item is invoiced before the last is finished

- **Symptom:** an accepted plan with items A and B: complete A, invoice it, complete B — the
  plan stays `accepted` forever. That is the normal clinic order (bill each visit).
- **How found:** review agent; confirmed by reading `derivePlanCompletion` (`chart.ts`), which
  required every sibling to be exactly `completed`. The ledger (Phase 2) is what made
  `invoiced` reachable, so this was latent until today. My own browser walk completed all three
  items before invoicing, which is why it didn't show.
- **Also:** a cancelled item blocked completion too, the check only ran on `completed`, and it
  looked at one plan (`limit(1)`) when a procedure can sit on several.
- **Fix:** done = every item completed, invoiced or cancelled, and at least one actually done;
  re-derived on completion and on cancellation, for every plan containing the procedure.
- **Tests:** "completes the plan even if an earlier item was invoiced…", "…when the last open
  item is cancelled".

## 11. Completing a procedure that's on an unaccepted plan breaks that plan

- **Symptom:** a planned procedure on a draft or presented plan could be completed, accepted
  or cancelled from the chart. Accepting the plan then failed (`TREATMENT_PLAN_ITEM_NOT_PLANNED`)
  with a message blaming "another plan", and the completed procedure had no price.
- **Root cause:** my bug-3 fix opened `planned → completed` without checking plan membership.
- **Fix:** `updateProcedureStatus` refuses any change to a `planned` procedure that is on a
  draft/presented plan, naming the plan (`PROCEDURE_ON_OPEN_PLAN`, 422). The chart panel now
  shows refused changes instead of failing silently (it showed no errors at all before).

## 12. A procedure could be marked "invoiced" with no invoice

- **Symptom:** `PATCH /procedures/:id { to_status: "invoiced" }` was legal from `completed`.
  The procedure then dropped out of "Create invoice" and, with no invoice line to void, could
  never be billed.
- **Fix:** `completed` has no manual transitions; only the ledger sets `invoiced`, when it
  creates a real invoice. Tests that walked to `invoiced` through the chart now mark it the way
  the ledger does.

## 13. Deleting a procedure that's on a plan returned a 500

- **Symptom:** chart **Delete** (or the charting undo) on a planned procedure already added to a
  plan hit the `treatment_plan_items` foreign key: an unmapped Postgres 23503, so a 500.
- **Fix:** `deleteProcedure` checks plan membership first and refuses with the plan's name
  (`PROCEDURE_ON_PLAN`, 422).

## 14. The void confirmation promised the wrong amount of credit

- **Symptom:** a ₹1,000 invoice with a ₹200 discount and ₹800 paid: the void step said "₹1,000
  already paid will move to patient credit"; only ₹800 does.
- **Root cause:** mine. The page worked out "paid" as `total − outstanding`, but outstanding
  also subtracts adjustments, so discounts counted as payments.
- **Fix:** the ledger returns `paid` per invoice (sum of its allocations) and the confirmation
  uses it. Test: "reports what was actually paid on each invoice, net of discounts".

## 15. Two payments at the same moment could overpay an invoice; credit could be spent twice

- **Symptom (reproduced):** two concurrent payments of ₹1,000 each allocated to a ₹1,000
  invoice both succeeded (outstanding −₹1,000); two concurrent apply-credits spent ₹1,000 of
  credit twice. Both new tests failed before the fix.
- **Root cause:** mine. `recordPayment`/`applyCredit` read the balance and inserted
  allocations without a lock, so under READ COMMITTED both validated against the same state.
  Adjustments locked the invoice; payments didn't. My earlier concurrency tests only covered
  invoice numbering and double-billing. Found independently by two review agents.
- **Fix:** every ledger write locks the patient row first (`SELECT … FOR UPDATE`), so one
  patient's ledger writes queue. A single lock taken first everywhere also rules out the
  lock-order deadlock a reviewer flagged on overlapping procedure sets.

## 16. A "discount" could raise the bill; oversized amounts gave a 500

- **Symptom:** `{ adjustment_type: "discount", amount: "500" }` was accepted and added ₹500.
  Amounts over ₹99,999,999.99 passed validation and failed in Postgres (numeric overflow, 500).
- **Fix:** discounts and write-offs must be negative (corrections may be either sign); money
  is capped at 8 whole digits in the request schema and in `toPaise`.

## 17. Smaller ledger fixes from the same review

- Malformed ids in ledger URLs (`/invoices/abc`) returned 500 (Postgres 22P02); now 404.
- After a payment or void, `/ledger` and an open printable invoice showed cached figures for
  up to 30 s; the Ledger tab now invalidates them.
- Idempotency hash depended on allocation order; now sorted.
- The apply-credit audit row used the invoice id as the allocation id; fixed.
- Record payment kept the last location/method across patients and could capture an invoice
  for "apply credit" before the ledger loaded; both now reset or derive on each opening.
