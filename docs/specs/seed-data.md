# Seed and Mock Data

Data lives in [`seed/mock-data.json`](../../seed/mock-data.json); the loader is `seed/index.ts`,
run with `pnpm seed`.

## What it is for

Three jobs, and they pull in different directions — this data set is tuned for all three:

1. **Development** — every screen has something on it from day one. No screen is built against an
   empty database, because empty databases hide the layout problems that dense data reveals.
2. **Demos** — to the partner dentist, and later to investors. It must look like a real clinic on a
   real Tuesday, not like test fixtures.
3. **Test fixtures** — deterministic, so tests can assert against known values.

## Shape

| Entity | Count | Notes |
|---|---|---|
| Organization | 1 | Sunrise Dental Care, Pune. **Not GST-registered** — the common case |
| Locations | 2 | Koregaon Park, Baner |
| Operatories | 5 | Including a dedicated hygiene room |
| Users | 6 | One per role: owner, provider, hygienist, front desk, assistant, accountant |
| Procedure codes | 23 | Real Indian dental treatments at realistic ₹ prices |
| Patients | 12 | |
| Alerts | 7 | Allergies, diabetes, blood thinners |
| Appointments | 17 | A full day today, plus past and future |
| Charted conditions | 7 | |
| Charted procedures | 12 | Across every status |
| Perio exams | 2 | Same patient, six months apart |
| Clinical notes | 4 | Signed, written the way a dentist actually writes |
| Invoices | 3 | Paid, part-paid, unpaid |

Password for every demo user: `DemoPassword123`. Emails use `.test`, which cannot resolve — no
risk of a stray email reaching a real address.

## Deliberate choices

**Nothing here is randomly generated.** Random data produces uniformly average screens, and average
screens hide bugs. Every record exists to exercise a specific state:

- **Patient 2 (Meenakshi Iyer) is the demo patient.** Diabetic, generalised moderate periodontitis
  worse in the upper right, Grade II furcation on 16, plus a baseline exam from six months ago
  showing 1–2mm deterioration. She exists so the perio grid has something worth looking at and the
  comparison view has a real story: *this patient is getting worse despite treatment.*
- **Patient 7 (Nikhil Rane) has no date of birth.** Indian patients frequently don't know or won't
  say. If the UI breaks on a null DOB, it breaks in the pilot.
- **Patient 6 (Ishita Banerjee) is a child** with a separate Responsible Party — exercises the
  payer-is-not-the-patient path and paediatric dentition.
- **Patient 8 (Sunita Deshmukh) has missing 46 and 47** and a planned lower denture — exercises
  missing-tooth propagation from the odontogram into the perio grid.
- **Patient 5 (Devendra Pawar) is on warfarin** with a scheduled surgical extraction — a critical
  alert that must be impossible to miss on the scheduling screen.
- **Today's schedule spans every appointment status** — completed, seated, arrived, confirmed,
  scheduled — so the day view shows its full colour range on first load. There is also a `no_show`
  last week.
- **Invoices cover all three payment states.** Patient 3 is deliberately part-paid (₹1,000 of
  ₹1,500) so the ledger has a non-zero balance to render.
- **Tax classes vary.** Crowns and implants are `gst_5`, whitening is `gst_18`, everything else
  exempt. The organization is not GST-registered, so no tax computes — flip
  `organization.gst_registered` to `true` to exercise the tax path without changing anything else.

## Dates

Stored as `day_offset` from the seed run date, never as absolute dates. Re-seeding on any day
produces a clinic whose "today" is today. Absolute dates rot within a week and make demos look
abandoned.

Times are wall-clock strings (`"09:30"`) resolved in `Asia/Kolkata`.

## Perio data format

Sites are compact tuples to keep the file readable:

```
[pocket_depth, gingival_margin, bleeding_on_probing, suppuration, plaque]
```

`"MB": [6, 2, true, true, true]` = 6mm pocket, 2mm recession, bleeding, suppuration, plaque.
CAL is computed (`6 + 2 = 8mm`), never stored.

Only clinically interesting teeth are listed. The loader fills the remainder with healthy values
(PD 2–3, no bleeding, no recession) so every exam is a complete full-mouth record. Tooth `18` is
explicitly `is_skipped` — a wisdom tooth the hygienist couldn't probe, which is normal and must
render as skipped rather than as zeros.

## Loader rules

- **Idempotent.** Re-running truncates the demo Organization and rebuilds it. It must never touch
  another Organization — the loader refuses to run if `NODE_ENV=production` unless
  `SEED_ALLOW_PRODUCTION=1` is set explicitly.
- **Goes through the service layer**, not raw inserts. If the seed can create it, the API can too —
  and the seed becomes a smoke test of the services for free.
- Keys (`"p1"`, `"kp1"`) are resolved to uuids at load time. They exist only in the JSON.
- The fee schedule is built from the `price` field on each procedure code.

## Not included

Documents and images (no binaries in the repo), treatment plans (build them by hand when testing
day 18–19), audit log entries (generated naturally by the loader writing through the services).
