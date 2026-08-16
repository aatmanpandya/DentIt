-- Row-Level Security setup. Applied by src/server/db/migrate.ts after drizzle migrations.
-- See docs/specs/data-model.md and docs/adr/0001-typescript-monolith-defer-python-ml.md.
--
-- The app connects as dentit_app, a non-superuser role with NOBYPASSRLS. A forgotten
-- WHERE clause in application code leaks nothing, because Postgres itself won't return
-- rows outside the session's app.current_org.

do $$
begin
  if not exists (select from pg_roles where rolname = 'dentit_app') then
    create role dentit_app login password 'dentit_app_dev' nobypassrls;
  end if;
end
$$;

grant usage on schema public to dentit_app;
grant usage, select on all sequences in schema public to dentit_app;

-- Default grant: full CRUD. audit_log is narrowed below — append-only, no UPDATE/DELETE.
grant select, insert, update, delete on all tables in schema public to dentit_app;

-- organizations has no organization_id column (it IS the tenant) — policy compares id directly.
alter table organizations enable row level security;
drop policy if exists tenant_isolation on organizations;
create policy tenant_isolation on organizations
  using (id = current_setting('app.current_org', true)::uuid)
  with check (id = current_setting('app.current_org', true)::uuid);

-- Every other table with an organization_id column gets the same policy, generated
-- automatically so a new table can't be added without RLS by mistake — the enforcement
-- test in db/rls.test.ts fails the build if a table has organization_id but no policy.
do $$
declare
  tbl text;
begin
  for tbl in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'organization_id'
      and c.table_name <> 'organizations'
  loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists tenant_isolation on %I', tbl);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = current_setting(''app.current_org'', true)::uuid) with check (organization_id = current_setting(''app.current_org'', true)::uuid)',
      tbl
    );
  end loop;
end
$$;

-- audit_log: append-only. Revoke UPDATE/DELETE explicitly even though the default grant
-- above included them — belt and suspenders on top of the application never calling them.
revoke update, delete on audit_log from dentit_app;

-- The real double-booking guard: Postgres refuses overlapping appointments in the same
-- operatory outright, not just via application logic. Requires btree_gist for the uuid
-- equality term inside the exclusion constraint.
create extension if not exists btree_gist;

alter table appointments
  drop constraint if exists appointments_no_overlap;

alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    operatory_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (status not in ('cancelled', 'no_show'));

-- Trigram search on patient name — powers `q=` on GET /patients. See docs/specs/data-model.md.
-- Lives here rather than a Drizzle-generated migration because the gin_trgm_ops operator
-- class requires the extension to exist first, and this file runs after all schema
-- migrations (see migrate.ts) — a plain Drizzle index would race the extension.
create extension if not exists pg_trgm;

drop index if exists patients_name_trgm_idx;
create index patients_name_trgm_idx on patients
  using gin ((first_name || ' ' || last_name) gin_trgm_ops);

-- procedure_codes starter template: organization_id IS NULL rows (see
-- docs/specs/pilot-foundations.md §1) are otherwise invisible to every tenant session,
-- because tenant_isolation's "organization_id = current_org" is never true against NULL.
-- Request-scoped code (POST /procedure-codes/import-starter) must still go through
-- dbForRequest, never adminDb, per CLAUDE.md's tenancy rule — so this additive, SELECT-only
-- policy is what makes the shared template readable. Postgres OR-combines permissive
-- policies for the same command, so a session can now see its own org's rows (via
-- tenant_isolation) OR the null-org template (via this policy). Writes are untouched:
-- tenant_isolation's WITH CHECK still requires organization_id = the session's own org, so
-- a request-scoped session can never create/edit the shared template itself.
drop policy if exists procedure_codes_read_starter_template on procedure_codes;
create policy procedure_codes_read_starter_template on procedure_codes
  for select
  using (organization_id is null);
