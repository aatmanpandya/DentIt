# DentIt

Practice management for dental clinics: scheduling, tooth charting, gum (perio) charting with
voice entry, clinical notes, treatment plans and billing.

Built by Aatman Pandya. All rights reserved; shared for review only.

## What it does

| Area | What a clinic gets |
|---|---|
| Schedule | Day, week and month views across operatories, with appointment status |
| Tooth chart | Conditions and treatments charted by tooth and surface |
| Perio chart | Six readings per tooth by mouse, keyboard or voice; comparison against earlier exams; transcript and approval |
| Clinical notes | Create, sign and amend; signed notes are locked |
| Treatment plans | Phases, live pricing, a patient-facing page, signature on acceptance |
| Billing | Invoices from completed work, payments, credit, void and reversal on an append-only ledger |

## How it is built

- **Next.js (App Router) and TypeScript**, Postgres with Drizzle, Vitest.
- **Clinics are isolated in the database.** Every table carries an organisation id and a Postgres
  row-level security policy; request queries run through `src/server/db/tenant.ts`.
- **All business logic lives in `src/server/services/`.** Route handlers under `src/app/api/v1/`
  authenticate, call one service and return.
- **Voice perio entry** is two stages: speech to text, then a tested grammar that turns words
  into readings (`src/lib/voice/`). A phrase writes exactly what was said, or nothing.

## Where to look

| Path | What is there |
|---|---|
| `docs/specs/` | The spec for each feature, written before the build |
| `docs/adr/` | Decision records |
| `docs/bug-log.md` | Every real bug hit while finishing the pilot, with cause, fix and commit |
| `evals/voice/` | The voice eval cases and the logged dictation sessions they came from |
| `CONTEXT.md` | Domain vocabulary |

## Run it locally

```bash
docker compose up -d db
cp .env.example .env.local
npm install
npm run db:generate && npm run db:migrate
npm run seed
npm run dev
```

Postgres listens on host port 55432. The demo sign-in is in `CLAUDE.md`. All patient data in the
seed and tests is invented.

## Checks

```bash
npm test             # unit and service tests
npm run typecheck
npm run lint
npm run eval:voice   # voice grammar eval: exact-match rate and wrong values written
```
