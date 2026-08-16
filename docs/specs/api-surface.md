# API Surface

All routes under `/api/v1/`. REST, JSON. Auth by bearer access token except where noted.

## The rule that makes this work

Business logic lives in `src/server/services/*`. Route handlers parse, authorise, call one service
method, and serialise. **Server components never query the database directly** — they call the same
services. This is what keeps the future mobile apps from becoming a rewrite, and it is the single
easiest thing to erode on a tired day. See [ADR-0001](../adr/0001-typescript-monolith-defer-python-ml.md).

```
src/server/
  services/          business logic, transaction boundaries, permission checks
  db/schema/         drizzle tables
  db/repositories/   query builders — no business rules
app/api/v1/          thin route handlers
```

## Conventions

| Aspect | Rule |
|---|---|
| Casing | `snake_case` in JSON, matching the database. No translation layer to get wrong |
| IDs | uuid strings |
| Dates | ISO 8601, always with offset. Server stores UTC; clients render in the Organization timezone |
| Money | string decimal (`"1450.00"`), never a JS number |
| Lists | `{ "data": [...], "next_cursor": "..." }` — cursor pagination, default 50, max 200 |
| Single | the object at the top level, not wrapped |
| Mutations | return the full updated object |
| Tenancy | never a URL parameter. Always from the token. A tenant-scoped path segment is a vulnerability waiting for a typo |
| Idempotency | `Idempotency-Key` header honoured on payment creation |

## Auth

```
POST   /auth/login                 { email, password } → { access_token, refresh_token, user }
POST   /auth/refresh               { refresh_token } → new pair, old refresh revoked
POST   /auth/logout                revokes the presented refresh token
POST   /auth/forgot-password       { email } → 204 always, regardless of existence
POST   /auth/reset-password        { token, password }
POST   /auth/accept-invite         { token, password, full_name }
GET    /auth/me                    → user, role, organization, accessible locations
```

`/auth/forgot-password` returns 204 whether or not the email exists. Distinguishing them leaks
your customer list.

## Organization settings

```
GET    /organization
PATCH  /organization                     owner only
GET    /locations
POST   /locations                        owner, admin
PATCH  /locations/:id
GET    /locations/:id/operatories
POST   /locations/:id/operatories
PATCH  /operatories/:id
GET    /users
POST   /users/invite                     owner, admin
PATCH  /users/:id                        role, active, location access
GET    /providers                        provider + hygienist users with profiles
PATCH  /providers/:id/schedule
```

## Patients

```
GET    /patients?q=&location_id=&cursor=      q searches name, phone, patient number
POST   /patients
GET    /patients/:id
PATCH  /patients/:id
DELETE /patients/:id                          soft delete, owner/admin only
GET    /patients/:id/summary                  alerts, next appointment, balance, last visit
GET    /patients/:id/alerts
POST   /patients/:id/alerts
PATCH  /alerts/:id
GET    /patients/:id/documents
POST   /patients/:id/documents                multipart
```

`/patients/:id/summary` exists so the chart header is one request, not five. It is the most-called
endpoint in the product; keep it fast and denormalised.

## Scheduling

```
GET    /appointments?location_id=&date=&provider_id=&operatory_id=
GET    /appointments?location_id=&from=&to=          week/month views
POST   /appointments
GET    /appointments/:id
PATCH  /appointments/:id                              time, operatory, provider, note
POST   /appointments/:id/transition                   { to_status, reason?, cancelled_by? }
POST   /appointments/:id/reschedule                   { starts_at, ends_at, operatory_id }
GET    /availability?location_id=&date=&duration=&provider_id=
GET    /appointment-types
POST   /appointment-types
GET    /schedule-blocks?location_id=&from=&to=
POST   /schedule-blocks
```

**Status changes go through `/transition`, never `PATCH`.** The transition table is a real state
machine and a generic PATCH would let the UI write any status it liked. Illegal transitions are a
422 naming the legal ones.

**`/availability` is server-computed.** The client never re-derives slot logic from provider hours
and blocks — two implementations of that rule will disagree, and the one on the client will be the
one the receptionist believes.

`/reschedule` is distinct from `PATCH` because it creates a new appointment and cancels the old one.

## Catalog and pricing

```
GET    /procedure-codes?category=&q=&active=
POST   /procedure-codes
PATCH  /procedure-codes/:id
POST   /procedure-codes/import-starter       copies the starter template into this org
GET    /fee-schedules
POST   /fee-schedules
GET    /fee-schedules/:id/items
PUT    /fee-schedules/:id/items               bulk upsert — the editor saves a grid
GET    /pricing?procedure_code_id=&location_id=&on_date=
```

`PUT` for fee schedule items is deliberate: the price editor is a spreadsheet-shaped screen and
saving it row by row would be both slow and non-atomic.

## Clinical

```
GET    /patients/:id/chart                    conditions + procedures, one payload
POST   /patients/:id/conditions
PATCH  /conditions/:id
POST   /patients/:id/procedures
PATCH  /procedures/:id
POST   /procedures/:id/complete               → status completed, sets completed_at
DELETE /procedures/:id                        planned only; otherwise cancel

GET    /patients/:id/perio-exams
POST   /patients/:id/perio-exams              creates the exam shell
GET    /perio-exams/:id                       full exam, all teeth and sites
PUT    /perio-exams/:id/teeth/:tooth          upserts the tooth record and its six sites
POST   /perio-exams/:id/complete
GET    /perio-exams/:id/compare?against=      prior exam delta, per site

GET    /patients/:id/notes
POST   /patients/:id/notes
PATCH  /notes/:id                             unsigned only
POST   /notes/:id/sign
POST   /notes/:id/amend                       creates a new note referencing this one
```

**`PUT /perio-exams/:id/teeth/:tooth` is the load-bearing endpoint of the whole product.** It fires
once per tooth as the operator advances, so it must be fast and it must be idempotent. It takes the
tooth record and all six sites in one body — the advance rule is per tooth, so the save boundary is
per tooth. Do not build a per-cell endpoint; 192 writes per exam over a clinic's wifi is a
different product.

## Treatment planning

```
GET    /patients/:id/treatment-plans
POST   /patients/:id/treatment-plans
GET    /treatment-plans/:id
PATCH  /treatment-plans/:id
POST   /treatment-plans/:id/phases
POST   /phases/:id/items                      { charted_procedure_id }
DELETE /items/:id
POST   /treatment-plans/:id/present
POST   /treatment-plans/:id/accept            { signature_image? }
```

## Ledger

```
GET    /patients/:id/ledger                   invoices, payments, adjustments, running balance
POST   /invoices                              { patient_id, charted_procedure_ids[] }
GET    /invoices/:id
POST   /invoices/:id/void                     { reason }
GET    /invoices/:id/pdf
POST   /payments                              honours Idempotency-Key
GET    /payments/:id
POST   /adjustments
```

There is no `PATCH /invoices/:id`. The ledger is append-only; a wrong invoice is voided and
reissued.

## Audit

```
GET    /audit?entity_type=&entity_id=&from=&to=&actor_user_id=     owner, admin only
```

## Not in the pilot

Patient portal, online booking, reminders, reporting endpoints, webhooks, public signup. Generated
OpenAPI ships in September; until then Zod schemas in `src/server/schemas/` are the contract.
