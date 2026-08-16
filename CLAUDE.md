# DentalPMS

Read `CONTEXT.md` for domain vocabulary and `docs/adr/` before touching schema. Full specs live
in `docs/specs/`.

## The one rule that must not erode

**All business logic lives in `src/server/services/*`.** Route handlers under `src/app/api/v1/`
parse the request, call one service method, and serialise the result — they never contain
business logic themselves. **Server components never query the database directly** — they call
the same services routes do.

This is deliberate, not stylistic: it's what lets the future Python ML service and the future
mobile apps reuse this logic instead of requiring a rewrite. See
`docs/adr/0001-typescript-monolith-defer-python-ml.md`.

## Tenancy — non-negotiable

Every domain table has `organization_id` and a Postgres RLS policy. Request-scoped queries go
through `dbForRequest()` in `src/server/db/tenant.ts`, never `adminDb` from `db/client.ts` —
`adminDb` bypasses RLS and is for migrations, seeding, and auth lookup only (where the org isn't
known yet).

Run `npm test` before any schema change — `src/server/db/rls.test.ts` fails the build if a new
table has `organization_id` but no RLS policy.

## Money, teeth, dates

- Money: `numeric(10,2)` in Postgres, decimal **strings** over the wire, never floats.
- Teeth: FDI canonical always. See `src/server/lib/tooth-notation.ts` and ADR-0003 — never store
  Universal notation, only render it.
- Dates over the wire: ISO 8601 with offset.

## Local dev

```
docker compose up -d db
cp .env.example .env.local   # then edit if ports differ
npm run db:generate && npm run db:migrate
npm run seed
npm run dev
```

Postgres runs on host port **55432**, not 5432 — something else on this machine already holds
5432. If that's no longer true in your environment, `docker-compose.yml` and `.env.example` can
both move back to 5432.

Demo login (any user from `seed/mock-data.json`): `ananya@sunrisedental.test` /
`DemoPassword123`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
