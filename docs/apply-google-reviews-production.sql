-- Production-only apply for the Google reviews migrations.
-- Do not put this file in supabase/migrations. Do not run it with supabase db push.
-- Run once, from the repo root, on a direct/session connection (not the
-- transaction pooler), only after the read-only preflight in
-- docs/google-reviews-activation.md.
--
-- supabase CLI 2.110.0 commits each migration file on its own. That would
-- commit cron.schedule('expire-stale-google-reviews') in 20261024091500
-- before 20261031140000 unschedules it. The schedule and unschedule below
-- share one transaction, so the job row is never committed.

\set ON_ERROR_STOP on

do $preflight$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-google-reviews') then
    raise exception 'expire-stale-google-reviews already exists';
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-google-reviews') then
    raise exception 'sync-google-reviews already exists';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version in (
      '20261024090000',
      '20261024091500',
      '20261031140000',
      '20261031160000',
      '20261031180000',
      '20261031200000'
    )
  ) then
    raise exception 'google reviews migration version already recorded';
  end if;
end
$preflight$;

begin;
\ir ../supabase/migrations/20261024090000_create_google_business_profile_reviews_schema.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261024090000', 'create_google_business_profile_reviews_schema');
commit;

begin;
\ir ../supabase/migrations/20261024091500_harden_google_reviews_sync_and_retention.sql
\ir ../supabase/migrations/20261031140000_separate_google_reviews_cleanup_schedule_and_harden_sync.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261024091500', 'harden_google_reviews_sync_and_retention');
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031140000', 'separate_google_reviews_cleanup_schedule_and_harden_sync');
commit;

begin;
\ir ../supabase/migrations/20261031160000_fix_google_review_id_regex_for_postgres.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031160000', 'fix_google_review_id_regex_for_postgres');
commit;

begin;
\ir ../supabase/migrations/20261031180000_guard_google_reviews_empty_reconciliation.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031180000', 'guard_google_reviews_empty_reconciliation');
commit;

begin;
\ir ../supabase/migrations/20261031200000_fix_featured_google_reviews_delete_for_safeupdate.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031200000', 'fix_featured_google_reviews_delete_for_safeupdate');
commit;
