# Ledger: invoices, payments, adjustments (Day 20)

Decisions from grilling on 2026-11-12, before implementation. The tables already exist in
`src/server/db/schema/ledger.ts` (migrated, RLS on); `docs/specs/data-model.md`'s "Ledger" section
and `docs/specs/api-surface.md`'s "Ledger" block are the starting point. Tax classes and the
`gst_registered` gate are `pilot-foundations.md` §1. What happens to a procedure once invoiced is
ADR-0002. Nothing in those documents is re-litigated except where noted.

Build order: service and tests, then routes, then UI.

## Shape of the ledger

**Append-only.** No edit or delete of invoices, payments, allocations or adjustments, and no
`PATCH`/`DELETE` routes for them. A wrong invoice is voided with a reason and reissued.

**Balance is computed, never stored.** For a patient:

```
owed     = Σ total of non-void invoices  +  Σ adjustments on non-void invoices
paid     = Σ payments
balance  = owed − paid            (negative = patient credit)
```

Per invoice: `outstanding = total + Σ its adjustments − Σ allocations to it`. A void invoice has no
outstanding. A payment's **unallocated credit** is `amount − Σ its allocations to non-void
invoices`. Credit is not a separate table: it is whatever part of a payment isn't allocated.

All money arithmetic is done in integer paise (`src/server/lib/money.ts`), never floats. Values
are `numeric(10,2)` in Postgres and decimal strings over the wire.

## Creating an invoice

`POST /invoices { patient_id, location_id, charted_procedure_ids[], prices? }`

- Every procedure must belong to the patient and be `completed`. Anything else:
  `PROCEDURE_NOT_INVOICEABLE` (422), nothing written.
- **Price** is the snapshot taken at plan acceptance (`charted_procedures.price`). A procedure that
  never went through a plan has no snapshot; its price is entered at invoicing in
  `prices: { [charted_procedure_id]: "1500.00" }` (`odontogram.md`'s pricing rule). Missing:
  `PROCEDURE_NOT_PRICED` (422). The UI pre-fills these from the current fee schedule but they
  stay editable. An entered price is written back to the procedure, so the procedure and its
  line agree (ADR-0002).
- One line per procedure: description is the code's short name plus tooth/surfaces or
  quadrant/arch ("Composite filling · 36 MO"), quantity 1.
- Each procedure moves `completed → invoiced` and gets `invoiced_at`.
- `status` is written as `issued`. The `draft` enum value is unused in the pilot.
- `responsible_party_id` is the patient's responsible party when one is on file, so a minor's
  invoice has an unambiguous payer.

**Location** is chosen in the Create invoice and Record payment panels, pre-filled by
`suggestInvoiceLocation()` in the service: the location of the procedures' appointments, else the
patient's most recent appointment's location, else the user's only accessible location, else the
first location. When procedures come from different locations it defaults to the most recent and
the panel says so. The printed invoice shows that location's address and phone.

## Tax

Tax only applies when `organizations.gst_registered` is true. The pilot clinic is not registered
(the question was never answered, so the default is `false`): its invoices are plain receipts, no
tax columns. The tax path is still built and tested so flipping the flag works.

- Rate comes from the procedure code's `tax_class` (`exempt_healthcare` 0%, `gst_5` 5%, `gst_18`
  18%) and is **snapshotted on the line** (`tax_class`, `tax_rate`, `tax_amount`), so historical
  invoices never change when rates do.
- **Prices are tax-inclusive by default.** `pilot-foundations.md` §1 already records that clinics
  bake tax into the quoted price, and an accepted plan promised the patient a total. New column
  `organizations.prices_include_tax` (default `true`) lets a clinic that quotes before tax switch.
  - inclusive: `tax = round(price × r / (100 + r))`, `unit_price = price − tax`, `line_total = price`
  - exclusive: `tax = round(price × r / 100)`, `unit_price = price`, `line_total = price + tax`
  - `unit_price` is therefore always the pre-tax figure. Rounding is per line, half-up, to the
    paisa. Invoice `subtotal = Σ unit_price`, `tax_total = Σ tax_amount`, `total = Σ line_total`.
- **Printed tax invoice** (registered clinic only): the clinic's GSTIN in the header; per line the
  base price, tax class and rate, tax amount, line total, and SAC 9993 (every dental service is
  9993; the tax class decides the rate, not the code). Footer: subtotal, then tax per rate split
  into **CGST + SGST**, each half the rate; the second half takes any odd paisa so the two always
  add up to the stored `tax_amount`. Intra-state only: IGST needs the patient's state, which isn't
  recorded. No GST filing, e-invoicing or IRN.

## Invoice numbers

`INV-YYYY-NNNN`, unique per organisation, sequential, restarting on 1 January. The year is the
calendar year **in the organisation's timezone** (IST), not the server's UTC. The number is at
least four digits, zero-padded.

Generation must be safe under concurrent requests. New table `invoice_number_counters
(organization_id, year, last_value)`, unique on `(organization_id, year)`, with RLS. The invoice
transaction runs `INSERT … ON CONFLICT (organization_id, year) DO UPDATE SET last_value =
last_value + 1 RETURNING last_value`. The row lock serialises concurrent creators, and a rolled-back
invoice releases its number, so there are no gaps. Tested with parallel creates. Seed sets the
counter past the seeded invoices.

## Voiding

`POST /invoices/:id/void { reason }`. Reason required. Sets `status = void`, `voided_at`,
`voided_by`. Already void: `INVOICE_ALREADY_VOID` (422).

- **Procedures go back from `invoiced` to `completed`** (`invoiced_at` cleared), so they can be
  reissued on a corrected invoice. The voided invoice keeps its lines untouched as the record of
  what was billed. "Which invoice is this procedure on?" means the line on a non-void invoice.
- **Money already paid becomes credit.** Allocations to a void invoice stop counting, so that
  amount becomes the patient's unallocated credit. The allocation rows stay as history. The void
  confirm step states the amount: "₹1,000 already paid will move to patient credit."

## Payments

`POST /payments { patient_id, location_id, amount, method, reference?, note?, allocations[] }`

- `method`: cash, card, UPI, bank transfer, cheque, other. `amount > 0`.
- Each allocation `{ invoice_id, amount }` must be on a non-void invoice of the same patient and
  not exceed that invoice's outstanding; together they may not exceed the payment:
  `PAYMENT_EXCEEDS_BALANCE` (422). Any remainder is patient credit.
- **`Idempotency-Key` header.** Stored on the payment, unique per organisation. A repeat with the
  same key and same body returns the original payment (200, no new row). Same key, different
  body: `IDEMPOTENCY_KEY_REUSED` (422). Without the header the request is processed normally.
- **Apply existing credit**: `POST /payments/apply-credit { patient_id, invoice_id, amount }`
  allocates unallocated credit to an invoice without recording new money. It writes new
  allocation rows against the patient's payments that have credit, oldest first. The Record
  payment panel offers it when the patient has credit.

## Reversing a payment

`POST /payments/:id/reverse { reason }`. Added 12 Nov after the first real use: a payment
recorded against the wrong patient or for the wrong amount had no way back, since the ledger
is append-only and `rls.sql` refuses UPDATE/DELETE on payments.

- A reversal is a new row in `payment_reversals` (one per payment, reason required). The
  payment row is untouched.
- A reversed payment no longer counts: it drops out of `paid`, its allocations stop paying
  down invoices (including allocations made by "apply credit"), and its unallocated credit
  disappears. The ledger keeps the payment entry and adds a "Payment reversed" entry, so the
  running balance shows both.
- Same permission rule as voids and adjustments: managers any time; front desk only on the
  IST day the money was received. Already reversed: `PAYMENT_ALREADY_REVERSED` (422). Audited.

## Discounts and GST (known limitation)

A discount, whether given at invoicing or later via Adjust, is an adjustment against the
invoice total: it lowers what the patient owes but does not recompute the lines' tax. For an
unregistered clinic (the pilot) there is no tax, so nothing changes. A GST-registered clinic
discounting a taxable line would, strictly, reduce the taxable value too; that needs a
line-level discount and is left for when a registered clinic uses the ledger.

## Adjustments

`POST /adjustments { invoice_id, amount, adjustment_type, reason }`. Signed amount (a discount or
write-off is negative); `discount | writeoff | correction`; reason required. Not on a void invoice,
and may not take the invoice's outstanding below zero.

## Who can do what

`invoices_payments` in the RBAC matrix: read for owner, admin, front desk, provider, accountant;
write for owner, admin, front desk, accountant.

**Voids and adjustments reduce what a patient owes, so they have one stricter rule** (one helper,
`assertCanReduceCharge`): owner, admin and accountant at any time; **front desk only on the same IST
calendar day the invoice was issued** ("Invoices from earlier days can only be voided by a
manager."). The UI disables the control with that reason. Demo: `nimisha` (owner) vs `sneha`
(front desk).

Every write goes to the audit log in the same transaction, like the other services.

## API

As `api-surface.md`'s Ledger block, minus the PDF, plus what the decisions above need:

```
GET  /patients/:id/ledger          entries in date order + running balance, invoices, credit
GET  /patients/:id/invoiceable     completed procedures not on a non-void invoice, with price
GET  /invoices/:id                 invoice, lines, allocations, adjustments, location, org tax info
POST /invoices                     { patient_id, location_id, charted_procedure_ids[], prices? }
POST /invoices/:id/void            { reason }
POST /payments                     honours Idempotency-Key
POST /payments/apply-credit        { patient_id, invoice_id, amount }
POST /adjustments                  { invoice_id, amount, adjustment_type, reason }
GET  /ledger                       org-wide: recent invoices, patients with a balance
GET  /invoices/suggest-location    ?patient_id=&charted_procedure_ids=
```

## UI

- **Patient Ledger tab** replaces the placeholder: balance (or credit) at the top, then invoices,
  payments, adjustments and voids in date order with a running balance. Buttons: Create invoice,
  Record payment.
- **Create invoice**: side panel (not a modal, per `ui-design.md`). Lists completed procedures not
  yet invoiced; tick to include; price shown and editable where there is no snapshot; location
  picker; live total.
- **Record payment**: side panel. Amount, method, reference, location, allocation to open
  invoices (defaults to oldest first), and "apply existing credit" when the patient has some.
- **Printable invoice**: `/patients/:id/invoices/:invoiceId/print`, same `window.print()`
  approach as the plan presentation page.
- **Void**: reason field and an inline confirm, since voiding is irreversible.
- **`/ledger`**: recent invoices and patients with an outstanding balance, linking to their
  Ledger tab.

## Scope cuts

- **`GET /invoices/:id/pdf` is replaced by the printable in-app invoice page** (browser print to
  PDF). No server-side PDF rendering.
- No GST filing, e-invoicing/IRN, IGST, online payments, insurance, refunds of credit as cash.
- If time runs short, in order: drop the `/ledger` page (and its nav item, never a 404), then the
  adjustments UI (keep the service), then allocation across several invoices (one invoice only).
