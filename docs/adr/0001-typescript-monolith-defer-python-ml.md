# TypeScript monolith now; Python ML as a separate service later

## Status

accepted

## Decision

The application is a single Next.js (App Router) codebase — route handlers under `/api/v1/`
serve as the API, with Postgres and Drizzle behind a service layer. Machine learning will
arrive later as a separate Python service reading the same Postgres, not as part of this app.

## Context

An earlier draft specified a Next.js frontend against a FastAPI backend, justified by the
requirement for in-house ML and analytics. That justification did not survive scrutiny: the ML
features in question (no-show risk, recall propensity, revenue forecasting) require years of
historical appointment data that a greenfield system does not have. They are a 2027 concern.
Meanwhile the build is one engineer, roughly three weeks, and every hour spent on cross-service
plumbing is an hour not spent on periodontal charting, which is the product's differentiator.

Onsite deployments reinforce this: clinics running their own hardware need the simplest possible
install artifact, and a single container plus Postgres is materially easier to support than two
runtimes.

## Considered Options

- **Next.js full-stack (chosen)** — one language, one deploy unit.
- **Next.js + FastAPI** — the original plan. Correct if ML were near-term; it isn't.
- **Next.js + NestJS** — cleaner service boundaries, no ML benefit, more setup cost.

## Consequences

When ML lands, it will be a second runtime rather than in-process. This costs essentially
nothing in latency, because the models are batch-scored: a scheduled job writes scores to a
column and the app reads them as ordinary fields. Real-time inference, if ever needed, is a
same-VPC hop on a non-interactive path.

The guarantee that this stays cheap depends entirely on the service-layer rule — business logic
lives in services that route handlers call, and server components never reach into the database
directly. If that erodes, the future Python service cannot reuse the logic and the migration
becomes a rewrite.

ML will likely be cloud-only. Onsite installs generate no centralised training data and would
need a second container. If a large share of clinics choose onsite, the ML work starves —
mitigate with a consented anonymised telemetry path if the models matter.
