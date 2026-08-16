# Validation and Errors

## Where validation happens

Three layers, each with a distinct job. Skipping a layer is how bad data lands in a clinical
record.

| Layer | Job | Example |
|---|---|---|
| **Zod schema** | Shape and format. Runs at the route boundary, before anything else | `pocket_depth` is an integer 0–15 |
| **Service** | Business rules needing context or other rows | This operatory is free at this time; this transition is legal |
| **Database** | Invariants that must hold no matter what code runs | Exclusion constraint on overlapping appointments; check constraints on ranges |

The same rule appearing in two layers is fine and often correct — the database constraint is the
one that survives a bug in the service.

Schemas live in `src/server/schemas/` and are **shared with the client**. One definition, used for
the form and the endpoint. A client-side rule that doesn't exist server-side is a vulnerability; a
server-side rule that doesn't exist client-side is a bad user experience.

## Error response

Every non-2xx returns the same shape:

```json
{
  "error": {
    "code": "APPOINTMENT_CONFLICT",
    "message": "Operatory 2 already has an appointment at this time.",
    "details": [
      { "field": "starts_at", "message": "Overlaps appointment 3f9a…" }
    ]
  }
}
```

- `code` — stable, `SCREAMING_SNAKE`, safe to switch on. Never changes once shipped.
- `message` — shown to the user as-is. Written in the interface's voice: says what happened and
  what to do. No apologies, no jargon, no stack traces.
- `details` — per-field, present on validation failures. Drives inline form errors.

## Status codes

| Code | Used for |
|---|---|
| 400 | Malformed request — unparseable body, bad cursor |
| 401 | No token, expired token, bad credentials |
| 403 | Authenticated but not permitted by role |
| 404 | Not found **or** belongs to another Organization |
| 409 | Conflict with current state — double-booked operatory, duplicate patient number |
| 422 | Well-formed but invalid — failed Zod, illegal state transition, business rule |
| 429 | Rate limited |
| 500 | Unhandled. Logged with a correlation id; the response never contains internals |

**404, never 403, for cross-tenant access.** A 403 confirms the record exists in someone else's
clinic. Both the service layer and RLS enforce this, and the cross-tenant test asserts 404
specifically.

## Error codes

```
AUTH_INVALID_CREDENTIALS      AUTH_ACCOUNT_LOCKED         AUTH_TOKEN_EXPIRED
AUTH_INVITE_INVALID           AUTH_SESSION_IDLE_TIMEOUT
PERMISSION_DENIED
VALIDATION_FAILED
NOT_FOUND
APPOINTMENT_CONFLICT          APPOINTMENT_ILLEGAL_TRANSITION
APPOINTMENT_OUTSIDE_HOURS     APPOINTMENT_BLOCKED_PERIOD
PROCEDURE_SCOPE_MISMATCH      PROCEDURE_INVALID_SURFACE
PROCEDURE_ALREADY_INVOICED    PROCEDURE_NOT_PRICED
PERIO_EXAM_COMPLETED
NOTE_ALREADY_SIGNED
FEE_SCHEDULE_NO_PRICE
INVOICE_ALREADY_VOID          PAYMENT_EXCEEDS_BALANCE
DUPLICATE_PATIENT_NUMBER      DUPLICATE_PROCEDURE_CODE
RATE_LIMITED                  INTERNAL_ERROR
```

## Messages that matter

Wording is design work, not an afterthought. These are the ones operators hit daily:

| Code | Message |
|---|---|
| `APPOINTMENT_CONFLICT` | "Operatory 2 already has an appointment at 10:30. Pick another time or operatory." |
| `APPOINTMENT_ILLEGAL_TRANSITION` | "A completed appointment can't be marked arrived." |
| `APPOINTMENT_OUTSIDE_HOURS` | "Dr Rao isn't scheduled at this time. Book anyway?" — a **warning with an override**, not a block. Clinics run late and squeeze people in |
| `PROCEDURE_INVALID_SURFACE` | "Tooth 11 is a front tooth — it has an incisal surface, not an occlusal one." |
| `PROCEDURE_NOT_PRICED` | "This treatment has no price in the current fee schedule. Add one to invoice it." |
| `FEE_SCHEDULE_NO_PRICE` | "No price set for this treatment on 14 Aug." |
| `NOTE_ALREADY_SIGNED` | "Signed notes can't be edited. Add an amendment instead." |
| `PAYMENT_EXCEEDS_BALANCE` | "That's more than the ₹2,400 outstanding. Record the extra as credit?" |

Note the pattern: where the clinic is doing something unusual but legitimate, offer the override.
Where the constraint is legal or clinical, state it plainly and name the alternative.

## Client handling

| Kind | Treatment |
|---|---|
| Field validation (422 with `details`) | Inline, beneath the field. No toast |
| Conflict (409) | Inline near the control, with the resolving action |
| Permission (403) | The control should not have rendered. If it did, that's a bug — log it |
| Network / 500 | Toast with a retry. Correlation id shown in small text for support |
| Idle timeout | Full-screen re-auth that preserves unsaved form state |

**The perio grid is the exception.** A failed save must never silently lose a tooth. On failure the
tooth stays visibly unsaved, entry continues uninterrupted, and a retry queue drains in the
background. An operator mid-exam with gloves on cannot deal with a modal.

## Empty and loading states

Empty screens are an invitation, not an apology:

- No patients — "No patients yet. Add your first patient to get started."
- No fee schedule — "No prices set. Import the starter list or add treatments yourself."
- Empty day — "Nothing booked for Tuesday 19 August."
- No perio history — "No gum measurements recorded. Start an exam."

Loading uses skeletons matching the final layout, never spinners over content. The perio grid and
day view render their structure immediately and fill values in — the shape of the screen is
information in itself.

## Logging

Every 5xx logs a correlation id, actor, tenant, route, and sanitised input. **Patient identifiers
and clinical values never appear in application logs** — that's what the audit log is for, and it
has access controls that log aggregators don't.
