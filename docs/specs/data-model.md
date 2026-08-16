# Data Model

Column-level schema for the pilot. Postgres 16, Drizzle.

## Conventions

Every domain table carries:

```
id              uuid    pk default gen_random_uuid()
organization_id uuid    not null references organizations(id)
created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
created_by      uuid    null references users(id)
updated_by      uuid    null references users(id)
deleted_at      timestamptz null          -- soft delete; 3-year retention
```

Exceptions: `organizations` has no `organization_id`; `audit_log` is append-only and has no
`updated_*` or `deleted_at`.

Rules:
- **Money** is `numeric(10,2)`. Never float.
- **Teeth** are `text` holding FDI codes (`'11'`–`'48'`, `'51'`–`'85'`), validated by a check
  constraint. Not integers — leading zeros and future notation extensions.
- **Soft delete everywhere.** Nothing clinical is hard-deleted; the Clinical Establishments Act
  requires 3-year retention.
- Every table gets an RLS policy on `organization_id`. The CI gate fails the build otherwise.
- Indexes on every FK, plus the specific ones called out below.

---

## Practice structure

### `organizations`
```
id, name, gst_registered bool not null default false, gstin text null,
tooth_notation_display enum('fdi','universal') not null default 'fdi',
probing_sequence jsonb null,        -- overrides the default arch order
deployment_target enum('cloud','onsite') not null default 'cloud',
timezone text not null default 'Asia/Kolkata',
currency char(3) not null default 'INR'
```

### `locations`
```
id, organization_id, name, address_line1, address_line2 null, city, state,
postal_code, phone, is_active bool default true
```

### `operatories`
```
id, organization_id, location_id, name, display_order int, is_active bool default true
```
Unique `(location_id, name)`.

### `users`
```
id, organization_id, email citext not null, password_hash text null,
full_name text, phone text null, role user_role not null,
is_active bool default true, last_login_at timestamptz null,
failed_login_count int default 0, locked_until timestamptz null
```
`user_role`: `owner | admin | front_desk | provider | hygienist | assistant | accountant`
Unique `(organization_id, email)`. `password_hash` is null until an invite is accepted.

### `user_location_access`
```
user_id, location_id        -- composite pk; absence of rows = all locations
```

### `provider_profiles`
```
id, organization_id, user_id unique, registration_number text null,
qualification text null, default_operatory_id null, color text  -- calendar colour
```

### `provider_schedules`
```
id, organization_id, provider_id, location_id, day_of_week int (0-6),
start_time time, end_time time, effective_from date, effective_to date null
```

### `schedule_blocks`
Holidays, lunch, leave.
```
id, organization_id, location_id null, provider_id null, operatory_id null,
starts_at timestamptz, ends_at timestamptz, reason text
```
At least one of location/provider/operatory must be set.

---

## Patients

### `patients`
```
id, organization_id, patient_number text not null,   -- human-facing, per-org sequence
first_name, last_name, date_of_birth date null, sex enum('male','female','other') null,
phone text not null, email citext null,
address_line1 null, address_line2 null, city null, state null, postal_code null,
preferred_location_id null, responsible_party_id null,
notes text null, is_active bool default true
```
Unique `(organization_id, patient_number)`.
Index: GIN trigram on `first_name || ' ' || last_name`, btree on `phone`, `patient_number`.

`date_of_birth` is nullable deliberately — Indian patients frequently don't know or won't give it,
and blocking registration on it makes front desk enter garbage.

### `responsible_parties`
```
id, organization_id, patient_id null,   -- set when the payer is also a patient
full_name, phone, email null, relationship text,
address_line1 null, city null, state null, postal_code null
```

### `patient_alerts`
Medical conditions, allergies, precautions. Shown on every clinical screen.
```
id, organization_id, patient_id, alert_type enum('allergy','medical','precaution'),
label text, detail text null, severity enum('info','warning','critical') default 'warning',
is_active bool default true
```

### `patient_documents`
```
id, organization_id, patient_id, filename, mime_type, size_bytes,
storage_key text, uploaded_by, description null
```

---

## Scheduling

### `appointment_types`
```
id, organization_id, name, default_duration_minutes int, color text, is_active bool
```

### `appointments`
```
id, organization_id, location_id, operatory_id, patient_id,
provider_id, appointment_type_id null,
starts_at timestamptz not null, ends_at timestamptz not null,
status appointment_status not null default 'scheduled',
note text null,
confirmed_at null, arrived_at null, seated_at null, completed_at null,
cancelled_at null, cancelled_by enum('patient','practice') null, cancellation_reason null,
rescheduled_to_id uuid null references appointments(id)
```
`appointment_status`: `scheduled | confirmed | arrived | seated | completed | cancelled | no_show`

Constraints:
- `ends_at > starts_at`
- Exclusion constraint on `(operatory_id, tstzrange(starts_at, ends_at))` for non-terminal
  statuses — the database refuses double-booking, not just the service layer
- Index `(location_id, starts_at)` — the day view's primary query

Transitions are enforced in `appointmentService.transition()`. See
[pilot-foundations.md §3](./pilot-foundations.md).

---

## Catalog and pricing

### `procedure_codes`
```
id, organization_id null,        -- null = starter template, copied at onboarding
code text, short_name text, description text null,
category procedure_category, applies_to procedure_scope,
surfaces_required bool default false,
tax_class tax_class default 'exempt_healthcare',
cdt_equivalent text null, is_active bool default true
```
Unique `(organization_id, code)`.
`procedure_category`: `diagnostic | preventive | restorative | endodontic | periodontic |
prosthodontic | oral_surgery | orthodontic | implant | cosmetic`
`procedure_scope`: `mouth | arch | quadrant | tooth | surface`
`tax_class`: `exempt_healthcare | gst_5 | gst_18`

### `fee_schedules`
```
id, organization_id, name, location_id null, effective_from date,
effective_to date null, is_default bool default false
```

### `fee_schedule_items`
```
id, organization_id, fee_schedule_id, procedure_code_id, price numeric(10,2)
```
Unique `(fee_schedule_id, procedure_code_id)`.

---

## Clinical

### `charted_conditions`
Findings, not work.
```
id, organization_id, patient_id, tooth text null, surfaces text[] null,
condition_type text,          -- caries, fracture, missing, impacted, ...
note text null, charted_by, charted_at timestamptz, resolved_at timestamptz null
```

### `charted_procedures`
The single source of truth — [ADR-0002](../adr/0002-charted-procedure-single-source-of-truth.md).
```
id, organization_id, patient_id, procedure_code_id,
tooth text null, surfaces text[] null, quadrant text null, arch text null,
status charted_procedure_status not null default 'planned',
provider_id null, appointment_id null,
price numeric(10,2) null,       -- snapshot at acceptance; null until priced
fee_schedule_id null,           -- which schedule produced that price
note text null,
completed_at null, invoiced_at null,
superseded_by_id uuid null references charted_procedures(id)
```
`charted_procedure_status`: `planned | accepted | scheduled | completed | invoiced | cancelled`

Rules:
- Scope must match the code's `applies_to`: a `surface` code without `surfaces` is a 422.
- Surfaces validated against the tooth — `O` on an anterior is rejected, `I` on a posterior is
  rejected.
- **Amendment after `invoiced` inserts a new row** and sets `superseded_by_id` on the original.
  Never mutate an invoiced procedure.
- Index `(patient_id, status)`.

### `perio_exams`
```
id, organization_id, patient_id, provider_id, exam_date date,
notes text null, completed_at timestamptz null
```
`provider_id` is who examined. Who *typed* lives in the audit log — either may record.

### `perio_tooth_records`
```
id, organization_id, exam_id, tooth text,
mobility int null check (0..3), furcation int null check (0..3),
is_skipped bool default false
```
Unique `(exam_id, tooth)`.

### `perio_site_measurements`
```
id, organization_id, exam_id, tooth text, site perio_site,
pocket_depth int null check (0..15),
gingival_margin int null check (-5..10),   -- positive = recession
bleeding_on_probing bool default false,
suppuration bool default false,
plaque bool default false
```
`perio_site`: `MB | B | DB | ML | L | DL`
Unique `(exam_id, tooth, site)`. Index `(exam_id, tooth)`.
**CAL is computed, never stored**: `pocket_depth + gingival_margin`.

### `clinical_notes`
```
id, organization_id, patient_id, appointment_id null, provider_id,
body text, signed_at timestamptz null, signed_by null,
amends_note_id uuid null references clinical_notes(id)
```
Signed notes are immutable. Amendments insert a new row pointing at the original.

---

## Treatment planning

### `treatment_plans`
```
id, organization_id, patient_id, name text, status enum('draft','presented','accepted','declined','completed'),
presented_at null, accepted_at null, signature_image_key text null, created_by
```

### `treatment_plan_phases`
```
id, organization_id, treatment_plan_id, name text, sequence int, note null
```

### `treatment_plan_items`
```
id, organization_id, treatment_plan_phase_id, charted_procedure_id, sequence int
```
References a Charted Procedure. Never copies tooth, surfaces, code, or price.

---

## Ledger

### `invoices`
```
id, organization_id, location_id, patient_id, responsible_party_id null,
invoice_number text, issued_at timestamptz, status enum('draft','issued','void'),
subtotal numeric(10,2), tax_total numeric(10,2) default 0, total numeric(10,2),
void_reason null
```
Unique `(organization_id, invoice_number)`.

### `invoice_lines`
```
id, organization_id, invoice_id, charted_procedure_id null,
description text, quantity int default 1, unit_price numeric(10,2),
tax_class tax_class, tax_rate numeric(5,2) default 0, tax_amount numeric(10,2) default 0,
line_total numeric(10,2)
```
`tax_rate` is snapshotted per line — rates change, historical invoices must not.

### `payments`
```
id, organization_id, location_id, patient_id, amount numeric(10,2),
method enum('cash','card','upi','bank_transfer','cheque','other'),
reference text null, received_at timestamptz, received_by, note null
```

### `payment_allocations`
```
id, organization_id, payment_id, invoice_id, amount numeric(10,2)
```
Sum of allocations must not exceed the payment. Unallocated remainder is patient credit.

### `adjustments`
```
id, organization_id, invoice_id, amount numeric(10,2),  -- signed
reason text, adjustment_type enum('discount','writeoff','correction'), created_by
```

**The ledger is append-only.** Corrections are reversing entries. Nothing is edited or deleted.

---

## Audit

### `audit_log`
```
id bigserial pk, organization_id, actor_user_id null, actor_ip inet null,
entity_type text, entity_id uuid, action enum('create','update','delete','sign','void','login','login_failed','logout','lockout','invite_accepted','password_reset'),
before jsonb null, after jsonb null, occurred_at timestamptz default now()
```
Append-only: no UPDATE or DELETE grant on this table for the application role. Index
`(organization_id, entity_type, entity_id)` and `(organization_id, occurred_at)`.

Written by a Drizzle middleware wrapper, not by hand at each call site — a call site that forgets
is the failure mode this must not have.
