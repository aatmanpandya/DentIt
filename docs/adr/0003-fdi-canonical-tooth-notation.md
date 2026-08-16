# FDI is the canonical tooth notation, permanently

## Status

accepted

## Decision

Teeth are stored as FDI two-digit codes (`11`–`48` permanent, `51`–`85` primary) everywhere in
the database. Universal notation (`1`–`32`, `A`–`T`) exists only as a rendering option selected
per Organization. Stored notation never changes, including on entry to the US market.

## Context

India, the UK, and Australia use FDI; the US uses Universal. Three of the four named target
markets are FDI, and India is first. FDI is also unambiguous for primary dentition, where
Universal switches from numbers to letters.

This is recorded because the instinct on entering the US market will be to "switch to Universal"
— and that instinct is wrong. Notation is a presentation concern. Migrating stored notation
across accumulated clinical history risks silently corrupting the tooth identity on every
charted procedure, perio measurement, and clinical note in the system, for no benefit a render
layer cannot provide.

## Consequences

A `toothNotation` module owns conversion in both directions. It is pure, isolated, and unit
tested before the first tooth is charted — the whole clinical record depends on it being
correct.

US-market users never see FDI in the interface, and any export, claim form, or integration
targeting a US system converts at the boundary, not in storage.
