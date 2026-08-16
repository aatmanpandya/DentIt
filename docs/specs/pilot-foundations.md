# Pilot Foundations Spec

Specs for the seven items that cannot be guessed without poisoning the schema. Everything else is
specified at the top of its phase.

Items marked 🔴 need confirmation from the partner dentist before the day they land.

---

## 1. Procedure code catalog and tax classification

### Decision

No Indian national dental procedure code standard exists (ABDM/NHA covers claims exchange via
NHCX, not procedure coding). So we own the catalog.

**The catalog is clinic-owned.** Indian clinics define treatments and prices manually, and both
vary clinic to clinic. There is no shared truth to encode, so we do not pretend otherwise:

- **Organization catalog** (primary) — `organization_id` set. Each clinic builds its own list.
  Fully editable. This is the path every pilot clinic uses.
- **Starter template** — `organization_id IS NULL`. A small, deliberately incomplete set of common
  treatments, *copied into* a clinic's catalog at onboarding so they can edit it, then forgotten.
  It is a convenience to avoid a blank screen, **not** a canonical list to converge on.

Copying rather than referencing matters: a clinic editing "RCT" must not mutate a row another
clinic depends on.

A canonical cross-clinic catalog is a **later** problem, and one worth revisiting only when
enough clinics are live to see what actually recurs. Attempting it now would be inventing a
standard from one data point.

A nullable `cdt_equivalent` column maps to CDT where one exists. Dead weight in India; the thing
that makes US entry tractable later. Leave it nullable and unenforced — clinics will not fill it
in, and that is fine.

### Schema

```
procedure_codes
  id                uuid pk
  organization_id   uuid null            -- null = system catalog
  code              text                 -- unique per (organization_id, code)
  short_name        text                 -- appears on the odontogram
  description       text
  category          procedure_category
  applies_to        procedure_scope
  surfaces_required bool                 -- forces surface selection when applies_to = 'surface'
  tax_class         tax_class
  cdt_equivalent    text null
  is_active         bool
```

`procedure_category`: `diagnostic | preventive | restorative | endodontic | periodontic |
prosthodontic | oral_surgery | orthodontic | implant | cosmetic`

`procedure_scope`: `mouth | arch | quadrant | tooth | surface`

**Tooth surfaces** — enum `M | O | D | B | L | I`. Occlusal (`O`) applies to posteriors, incisal
(`I`) to anteriors; validated against tooth number, not left to the user.

### Tax classification

Indian dental services are **not uniformly GST-exempt**, so tax is a property of the procedure
code, never of the invoice:

| `tax_class` | Rate | Applies to |
|---|---|---|
| `exempt_healthcare` | 0% | Consultations, cleanings, fillings, RCT, extractions — healthcare services under SAC 9993 |
| `gst_5` | 5% | Implants, crowns, bridges, dentures supplied as goods |
| `gst_18` | 18% | Cosmetic procedures — whitening, veneers for aesthetic indication |

Sources: [Busy](https://busy.in/gst-rates/dental-services/),
[Taxmann AAR](https://www.taxmann.com/post/blog/no-gst-on-providing-dental-health-care-services-by-dental-clinic-aar/),
[ClearTax](https://cleartax.in/s/gst-doctors-medical-fees).

**Organization-level gate.** Many small clinics are not GST-registered at all. `organizations` gets
`gst_registered bool` and `gstin text null`. When `gst_registered` is false, no tax lines are
computed and invoices print as plain receipts. This is the common case for the pilot.

### The tax that actually matters is on the way *in*, not the way *out*

Confirmed with the partner clinic: GST is paid by the clinic when **buying materials** — the
implant fixture, the crown from the lab, consumables — and is then **baked into the price quoted
to the patient**. The patient's bill shows no tax.

That is not a workaround; it is forced by the law. **Input Tax Credit is blocked on inputs used
for exempt supplies.** Because most dental treatment is exempt under SAC 9993, the GST the clinic
paid on materials is *unrecoverable* — a real, sunk cost that has to be absorbed into the price.
([Tax2win](https://tax2win.in/guide/gst-for-doctors-india), [ClearTax](https://cleartax.in/s/gst-doctors-medical-fees))

The nuance that makes this worth building properly: **clinics doing both exempt and taxable work
have a mixed supply.** Crowns, implants and dentures supplied as goods are taxable, and ITC *is*
recoverable on those inputs. A mixed clinic must apportion ITC by the ratio of exempt to total
supply value. Most clinics do this badly or not at all, because their software gives them no
visibility into it.

**So the feature is cost visibility, not tax calculation:**

```
procedure_material_costs        -- deferred, design recorded now
  procedure_code_id
  material_name
  unit_cost         numeric     -- pre-GST
  input_gst_rate    numeric     -- what the clinic paid
  itc_recoverable   bool        -- false when the treatment is exempt
```

With that, a clinic can see, per treatment: what it truly cost, how much unrecoverable tax is
buried in it, and the actual margin on the price they quote. That is a genuinely differentiated
answer to "am I making money on implants?" — a question their current software cannot answer.

**Not in the pilot.** Prices and methods are manual and clinic-dependent, so this waits until
clinics are live and we can see real material lists. Recorded here so the design isn't
rediscovered from scratch.

🔴 **Still worth asking their accountant:** whether the clinic is GST-registered, and whether they
bill crowns/implants as taxable goods or absorb them into an exempt service. This decides whether
`gst_registered` is even true for the pilot clinics.

---

## 2. Perio measurement set

### Sites

Six per tooth: `MB, B, DB` (buccal aspect), `ML, L, DL` (lingual aspect).

### Per-site measurements

| Field | Type | Range | Notes |
|---|---|---|---|
| `pocket_depth` | int (mm) | 0–15 | Required. The only mandatory field |
| `gingival_margin` | int (mm) | −5 to +10 | **Positive = recession** (margin apical to CEJ). Convention fixed here; never change it |
| `bleeding_on_probing` | bool | | |
| `suppuration` | bool | | |
| `plaque` | bool | | Recorded as standard — confirmed by the partner dentist |

**Clinical Attachment Level is computed, never stored**: `CAL = pocket_depth + gingival_margin`.
Storing it invites the two values disagreeing.

### Per-tooth measurements

| Field | Type | Range | Notes |
|---|---|---|---|
| `mobility` | int | 0–3 | Miller classification |
| `furcation` | int | 0–3 | Glickman. Only offered on multi-rooted teeth — molars, and upper first premolars (`14`, `24`) |

Missing teeth, crowns, and implants are **not** re-entered — they propagate from the Odontogram.

### Schema

Two tables, per [ADR-0002](../adr/0002-charted-procedure-single-source-of-truth.md)'s spirit:

```
perio_exams            id, organization_id, patient_id, provider_id, exam_date, notes
perio_tooth_records    exam_id, tooth (FDI), mobility, furcation
perio_site_measurements exam_id, tooth (FDI), site, pocket_depth, gingival_margin,
                        bleeding_on_probing, suppuration, plaque
```

Index `(exam_id, tooth)`. A full-mouth exam is 32 tooth records and 192 site rows. Read whole
exams at once; compute comparison against a prior exam as a query.

### Input model — confirmed with the partner dentist

**Both mouse and keyboard are first-class.** Not keyboard-first with mouse as a fallback: either
input method must be able to drive a full exam start to finish. Any cell is directly clickable;
any cell is reachable by keyboard.

**Advance is per tooth, not per site.** The cursor moves to the next tooth to the right only once
*every* measurement for the current tooth has been entered. Within a tooth, entry moves between
its sites. This is the single most important interaction detail in the build — it means the unit
of work is a tooth, and the UI should visibly treat it that way (current tooth highlighted as a
group, not a single cell).

Consequences:
- "Entered" must include the booleans. Decide explicitly whether an untouched bleeding checkbox
  counts as `false` (advance) or as unanswered (block). **Recommendation: default `false`, advance
  freely** — blocking on unticked boxes would stall the operator constantly.
- A tooth with missing measurements must be visibly incomplete, and jumping back to it must be one
  click or one key.
- Skipping a tooth entirely (missing tooth, patient can't tolerate probing) must be possible
  without filling anything.

Default sequence: buccal aspect of the upper arch `18 → 28`, then lingual `28 → 18`, then lower
buccal `48 → 38`, then lingual `38 → 48`. Configurable per Organization.

**Both dentists and assistants record perio.** The partner clinic does it either way depending on
who is free, so both must have write access — see §4.

---

## 3. Appointment status lifecycle

```
                  ┌─────────────┐
                  │  SCHEDULED  │
                  └──────┬──────┘
                         ▼
                  ┌─────────────┐
                  │  CONFIRMED  │
                  └──────┬──────┘
                         ▼
   ┌─────────┐    ┌─────────────┐
   │ NO_SHOW │◄───│   ARRIVED   │
   └─────────┘    └──────┬──────┘
                         ▼
                  ┌─────────────┐
                  │   SEATED    │
                  └──────┬──────┘
                         ▼
                  ┌─────────────┐
                  │  COMPLETED  │
                  └─────────────┘
```

**Legal transitions:**

| From | To |
|---|---|
| `SCHEDULED` | `CONFIRMED`, `ARRIVED`, `CANCELLED`, `NO_SHOW` |
| `CONFIRMED` | `ARRIVED`, `CANCELLED`, `NO_SHOW` |
| `ARRIVED` | `SEATED`, `NO_SHOW` |
| `SEATED` | `COMPLETED` |
| `COMPLETED` | — terminal |
| `CANCELLED` | — terminal |
| `NO_SHOW` | — terminal |

Rules:
- Transitions are enforced in the service layer, not the UI. Illegal transitions are a 422.
- `CANCELLED` requires `cancelled_by` (`patient | practice`) and a reason — it feeds the
  broken-appointment metric later.
- Rescheduling **creates a new appointment** and sets the original to `CANCELLED` with
  `rescheduled_to_id`. Never mutate the time in place; the audit trail must show both.
- Only `COMPLETED` appointments make their Charted Procedures billable.

---

## 4. RBAC roles and permission matrix

Seven roles. A User holds one role per Organization, plus explicit Location access.

| Resource | Owner | Admin | Front Desk | Provider | Hygienist | Assistant | Accountant |
|---|---|---|---|---|---|---|---|
| Patients — read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Patients — write | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Appointments — read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Appointments — write | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Odontogram — read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Odontogram — write | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Perio — read | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Perio — write | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Clinical notes — write | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Clinical notes — sign | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Treatment plans — read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Treatment plans — write | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Invoices/payments — read | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Invoices/payments — write | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Fee schedules | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Users & roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Org settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Audit log | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

Notes:
- **Front desk cannot write clinical data.** Non-negotiable — it's the control that makes the audit
  trail meaningful under India's EHR Standards and HIPAA alike.
- **Assistants can write perio.** Confirmed with the partner clinic: whoever is free records the
  measurements, dentist or assistant. Perio is the *only* clinical write an Assistant has —
  odontogram and clinical notes remain restricted to Owner, Provider, and Hygienist. The reasoning
  is that perio measurements are transcribed readings called out by the clinician, not independent
  clinical judgement.
- Every perio write records the operator, so a dentist-dictated, assistant-typed exam is
  attributable to both: `perio_exams.provider_id` (who examined) and the audit log (who typed).
- Signed clinical notes are immutable; amendments append. Nobody, including Owner, can edit a
  signed note.
- Permissions are checked in the service layer. The UI hides what it must, but hiding is not
  enforcement.

---

## 5. Fee schedule structure

```
fee_schedules
  id, organization_id, name, location_id null, effective_from date,
  effective_to date null, is_default bool

fee_schedule_items
  fee_schedule_id, procedure_code_id, price numeric(10,2)
```

**Resolution order** for the price of a code on a given date:
1. Location-specific schedule active on that date
2. Organization default schedule active on that date
3. No price → the procedure can be charted but not invoiced; surfaced as a data-quality warning

Rules:
- Effective-dated. Editing a live schedule creates a new version rather than mutating rows —
  historical invoices must continue to reprice identically.
- Prices are per-Organization always. There is no global price list.
- No provider-level pricing in the pilot. Add later only if a clinic actually asks.
- `numeric(10,2)`, never floats.

---

## 6. Hosting and region

**Decision: DigitalOcean Bangalore (`blr1`)** — App Platform plus Managed Postgres, for the pilot.

Rationale: health data stays in India, which matters commercially with Indian clinics regardless of
whether DPDP strictly mandates localisation. DO is materially simpler to operate solo than AWS, and
during a 20-day build plus a support-heavy pilot month, operational simplicity is worth more than
platform depth.

Migration cost if you outgrow it is low — a Postgres dump and a container redeploy. That is why
this is *not* an ADR: it's reversible.

Rejected: AWS `ap-south-1` (more capable, more setup and ops tax than a solo pilot can absorb);
Vercel + Neon (no India region for the database; residency is the blocker); anything in a
non-India region.

**Required before go-live:**
- Daily automated backups **with a restore actually tested once**. An untested backup is not a
  backup, and pilot clinics have real patient data from day one.
- TLS everywhere; Postgres not publicly reachable.
- Encryption at rest (DO Managed Postgres default).
- Staging environment sharing the production image.

---

## 7. Auth flows

**Account creation is invite-only.** No public signup during the pilot — you create each
Organization manually.

| Flow | Spec |
|---|---|
| Invite | Owner/Admin invites by email → single-use token, 72h expiry → invitee sets password → account active |
| Password | argon2id. Minimum 12 characters. No composition rules, no forced rotation — both increase password reuse |
| Login | Email + password. 5 failed attempts → 15-minute lockout on the account, logged to audit |
| Session | JWT access token 15 min; refresh token 7 days with rotation on use |
| Idle timeout | 30 minutes → re-auth. Required by HIPAA's automatic-logoff addressable spec, and sensible on a shared operatory machine |
| Absolute session | 12 hours → re-auth regardless of activity |
| Password reset | Email token, 1h expiry, single use, invalidates all refresh tokens |
| Logout | Revokes the refresh token |

Deferred to the hardening month: TOTP 2FA (build it before any US customer — HIPAA reviewers will
ask), SSO, device trust.

Every auth event — login, failure, lockout, reset, invite acceptance, logout — writes to the audit
log with actor, IP, and timestamp.

---

## Open questions blocking specific days

| Day | Blocked on | Status |
|---|---|---|
| 1 | Nothing | Clear |
| 13 | Probing sequence, plaque, input model, who records | ✅ **Answered** — mouse + keyboard both first-class, advance per tooth, plaque recorded, assistants may write |
| 17 | Treatment list + prices | **Deferred by decision.** Prices and methods are manual and clinic-dependent; clinics build their own catalog at onboarding. Build the catalog *editor*, not a catalog |
| 19 | Is the clinic GST-registered? | 🔴 Open — ask their accountant. If no, day 19 shrinks to plain receipts |

Nothing blocks day 1. The only remaining question is GST registration status, and it can be
answered any time before day 19.
