# Perio exam transcript and approval

Decided 14 Nov 2026 with the owner. A perio exam becomes the permanent record only when a
dentist or hygienist has reviewed **how it was made** and approved it. Builds on `perio.md`
(entry, lifecycle) and `voice-perio.md` (dictation).

## Decisions

- **Who approves:** owner, dentists (provider) and hygienists — the people who sign clinical
  notes (`perio.approve` in `permissions.ts`). Assistants enter perio but can't approve.
- **What the transcript holds:** every dictated phrase (Chrome's guesses, the reading used,
  written / refused / waiting / undo, the cells it changed old → new), every keyboard or click
  edit ("typed", the change list worked out on the server), every approval and reopening.
- **After approval:** locked. An approver can reopen it with a reason; the reason goes in the
  transcript, and the exam must be approved again.
- **No audio** is kept: Chrome doesn't hand it over, and text is the record.

## Data

`perio_exam_events` (RLS like every tenant table; append-only: `rls.sql` revokes UPDATE and
DELETE): `exam_id`, `kind` (`phrase | typed | approved | reopened`), `heard` (jsonb), `used`,
`outcome`, `note`, `changes` (jsonb `[{ tooth, site, field, from, to }]`), `created_at`,
`created_by`. `perio_exams` gains `approved_at`, `approved_by`; approval also sets
`completed_at`, which is what locks the exam. Exams completed before this existed count as
approved on their completion date (migration 0014).

## API

```
GET  /perio-exams/:id/events      the transcript, oldest first, with who did each step
POST /perio-exams/:id/events      one dictated phrase (the voice bar sends every one)
POST /perio-exams/:id/complete    approve: perio.approve only
POST /perio-exams/:id/uncomplete  { reason } — perio.approve only; approved exams only
PUT  /perio-exams/:id/teeth/:t    source: "voice" saves aren't logged again; others log "typed"
```

## UI

The perio exam header says **Draft — not approved** or **Approved · approved by …**. "Complete
exam" is replaced by **Review and approve**: a side panel with counts (dictated, typed,
refused, undone), the transcript in order, and **Approve exam** (or, for an assistant, who
can). An approved exam shows **Transcript**, with **Reopen exam** and a required reason.
