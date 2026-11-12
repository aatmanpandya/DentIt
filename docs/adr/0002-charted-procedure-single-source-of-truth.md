# Charted Procedure is the single source of truth

## Status

accepted

## Decision

`charted_procedures` is the one table representing a treatment on a tooth. The Odontogram,
Treatment Plans, and the ledger all reference rows in it. A treatment plan item holds a foreign
key to a Charted Procedure; it does not copy the tooth, surfaces, code, or price.

## Context

The obvious implementation is for each module to own its own representation — the chart records
what was found, the treatment plan records what was proposed, the invoice records what was
billed. That reads cleanly and is how many practice management systems are built.

It also produces the defining data bug of the category: the chart and the plan disagree. A
procedure is amended on the odontogram and the accepted plan still shows the old surfaces. A
plan is re-priced and the invoice bills the stale figure. Once clinical history exists in
production these divergences cannot be reconciled automatically, because there is no way to
know which copy was correct.

Making one row the truth, with a status lifecycle
(`planned → accepted → scheduled → completed → invoiced`), makes the divergence unrepresentable.

## Consequences

Modules are more coupled than they would otherwise be — a change to the Charted Procedure shape
touches charting, planning, and billing together. This is deliberate; the coupling reflects a
real domain constraint rather than an accident of design.

Historical accuracy needs explicit handling. An invoiced procedure must not silently change if
the chart is later amended, so amendments after `invoiced` create a new row and mark the
original superseded, rather than mutating in place.

## Amendment (2026-08-26)

A treatment plan item may now hold *either* a Charted Procedure reference *or* its own copy of
code/tooth/surfaces/quadrant/arch — the latter only while nothing has been charted yet, so a plan
can be drafted without an Odontogram entry existing first. See
`docs/specs/treatment-planning.md`'s "Adding a treatment without charting first" for the full
rationale and mechanism. The core decision above is **not reversed**: the copy is temporary and
scoped to the pre-charting state of a single item. The moment a plan reaches `accepted` — the point
real clinical commitment happens — every item is promoted to a real Charted Procedure and its own
copied fields are cleared, so the single-source-of-truth invariant holds for anything that actually
gets scheduled, completed, or invoiced. A plan that's only ever drafted or declined never produces
a Charted Procedure at all, which is fine: nothing was ever "the chart" for it, so there's nothing
that can diverge.
