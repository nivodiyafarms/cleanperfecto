-- Production SQL Editor apply for project numabqpfnigejtdwpxng.
-- Dashboard equivalent of docs/apply-google-reviews-production.sql.
-- This file is not a migration. Do not put it in supabase/migrations.
-- Do not run it with supabase db push. Do not run it on Preview
-- pitvmtsenkcuapixrilg.
--
-- One outer transaction. Confirmed before wrapping: the six files contain
-- only transaction-compatible statements (create/alter table, comment,
-- trigger, row level security, grant/revoke, insert, view, create/drop/
-- replace function, and cron.schedule / cron.unschedule). Those cron
-- calls insert and delete cron.job in the current transaction; they are
-- not autonomous. None of the files contain CREATE INDEX CONCURRENTLY,
-- REINDEX CONCURRENTLY, VACUUM, CLUSTER, CREATE/DROP DATABASE,
-- CREATE/DROP TABLESPACE, or ALTER SYSTEM. BEGIN/END inside function
-- bodies is PL/pgSQL, not a transaction boundary. There is no \i, \ir,
-- \set, or intermediate COMMIT.
--
-- Production supabase_migrations.schema_migrations is
-- (version text not null, statements text[] null, name text null).
-- History inserts set version and name only, so statements stays null,
-- matching docs/apply-google-reviews-production.sql.
--
-- Paste this entire script into the SQL Editor and run it once.
-- Do not run a selection.

begin;

do $precheck$
declare
  latest_version text;
begin
  select version
  into latest_version
  from supabase_migrations.schema_migrations
  order by version desc
  limit 1;

  if latest_version is distinct from '20261019090000' then
    raise exception 'expected latest applied version 20261019090000, found %',
      coalesce(latest_version, '<none>');
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
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

  if exists (select 1 from cron.job where jobname = 'expire-stale-google-reviews') then
    raise exception 'expire-stale-google-reviews already exists';
  end if;

  if exists (select 1 from cron.job where jobname = 'sync-google-reviews') then
    raise exception 'sync-google-reviews already exists';
  end if;

  if (
    select count(*)
    from cron.job
    where jobname = 'cleanperfecto-notification-dispatch'
  ) is distinct from 1
  or (
    select count(*)
    from cron.job
    where jobname = 'retry_stuck_webhook_events'
  ) is distinct from 1 then
    raise exception 'cleanperfecto-notification-dispatch and retry_stuck_webhook_events must each already exist exactly once';
  end if;
end
$precheck$;

create temp table google_reviews_apply_cron_baseline on commit drop as
select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'cleanperfecto-notification-dispatch',
  'retry_stuck_webhook_events'
);

-- >>> 20261024090000_create_google_business_profile_reviews_schema.sql
-- ============================================================================
-- Migration: Google Business Profile reviews cache + admin curation + sync state
--
-- Google Business Profile Reviews milestone (homepage display). This is a
-- new, independent feature area — no pricing/booking/payment table is
-- touched. Prepared and verified against the disposable Supabase project
-- only (see .env.disposable.local / project ref ggcmjiqzsuxlwnoatyjj); NOT
-- applied to production (numabqpfnigejtdwpxng) in this phase. Applying to
-- production requires the same explicit, separate authorization as every
-- other group in "Approved Production Migration Groups."
--
-- Three tables:
--   - google_business_profile_reviews: the synced cache of reviews actually
--     returned by Google. Never a permanent archive — every row carries
--     last_seen_at so the sync job can enforce a content-retention expiry
--     even if syncing stops or Google authorization is revoked (see
--     src/lib/google-reviews/retention.ts). Reviews no longer present in a
--     *complete* successful fetch are deleted by the reconciliation step
--     (never by a partial/failed fetch — see src/lib/google-reviews/sync.ts).
--   - featured_google_reviews: the admin's curated subset + display order
--     shown on the homepage. FK cascade means a review Google stops
--     returning (and that therefore gets reconciled away) automatically
--     drops out of the featured set too.
--   - google_business_profile_sync_state: a singleton row (id = 1) holding
--     Google's own aggregate rating/count — shown on the homepage as-is,
--     never recomputed from the featured subset — plus last sync status for
--     the admin screen.
--
-- Same zero-policy convention as every other table in this schema: RLS
-- enabled, anon/authenticated get zero grants, service_role gets exactly
-- the operations the app needs. No table here is ever queried from the
-- browser directly — the homepage section and admin screen are server
-- components/actions that select only the public-safe columns they need.
-- ============================================================================

create table public.google_business_profile_reviews (
  id uuid primary key default gen_random_uuid(),

  google_review_id text not null unique,
  reviewer_display_name text not null,
  reviewer_photo_url text,
  star_rating smallint not null check (star_rating between 1 and 5),
  review_text text,
  review_created_at timestamptz not null,
  review_updated_at timestamptz not null,

  first_synced_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_business_profile_reviews is
  'Synced cache of reviews returned by the Business Profile API for our verified listing. Not a permanent archive — last_seen_at drives a content-retention expiry (see retention.ts) independent of whether syncing is currently working. review_text is nullable because a rating-only Google review has no text.';

comment on column public.google_business_profile_reviews.last_seen_at is
  'Updated to now() only when a COMPLETE successful fetch of every review page re-confirms this row. Drives (a) retention expiry — a row whose last_seen_at falls outside the retention window is deleted regardless of sync outcome, and (b) is distinct from review_updated_at, which is Google''s own edit timestamp for the review content itself.';

create trigger google_business_profile_reviews_set_updated_at
before update on public.google_business_profile_reviews
for each row execute function public.set_updated_at();

alter table public.google_business_profile_reviews enable row level security;

revoke all privileges
on table public.google_business_profile_reviews
from anon, authenticated;

grant select, insert, update, delete
on table public.google_business_profile_reviews
to service_role;

-- ----------------------------------------------------------------------------

create table public.featured_google_reviews (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.google_business_profile_reviews (id) on delete cascade,
  display_order smallint not null check (display_order between 1 and 5),
  created_at timestamptz not null default now(),

  unique (review_id),
  unique (display_order)
);

comment on table public.featured_google_reviews is
  'Admin-curated subset (up to 5) + order shown in the homepage "Featured Google Reviews" section. on delete cascade: if a review is reconciled away because Google no longer returns it, it automatically drops out of the featured set rather than leaving a dangling reference.';

alter table public.featured_google_reviews enable row level security;

revoke all privileges
on table public.featured_google_reviews
from anon, authenticated;

grant select, insert, update, delete
on table public.featured_google_reviews
to service_role;

-- ----------------------------------------------------------------------------

create table public.google_business_profile_sync_state (
  id smallint primary key default 1 check (id = 1),

  overall_rating numeric(2, 1),
  total_review_count integer,

  last_successful_sync_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_sync_error text,

  updated_at timestamptz not null default now()
);

comment on table public.google_business_profile_sync_state is
  'Singleton (id = 1, seeded below, never inserted again by the app) holding Google''s own aggregate rating/total_review_count from the reviews.list response — the homepage always shows this, never a figure recomputed from only the featured cards. last_successful_sync_at is null until the first real sync ever completes; the homepage section stays hidden until it is non-null AND at least one featured review exists.';

create trigger google_business_profile_sync_state_set_updated_at
before update on public.google_business_profile_sync_state
for each row execute function public.set_updated_at();

insert into public.google_business_profile_sync_state (id) values (1);

alter table public.google_business_profile_sync_state enable row level security;

revoke all privileges
on table public.google_business_profile_sync_state
from anon, authenticated;

grant select, update
on table public.google_business_profile_sync_state
to service_role;
-- No insert/delete grant — exactly one row exists for the lifetime of the
-- table, seeded by this migration; the app only ever updates it.
-- <<< 20261024090000_create_google_business_profile_reviews_schema.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261024090000', 'create_google_business_profile_reviews_schema');

-- >>> 20261024091500_harden_google_reviews_sync_and_retention.sql
-- ============================================================================
-- Migration: Google Business Profile reviews — atomic sync + independent
-- retention enforcement + public-read expiry filtering.
--
-- Follow-up to 20261024090000_create_google_business_profile_reviews_schema.sql,
-- addressing three gaps found on review:
--
-- 1. RETENTION MUST BE GUARANTEED, NOT JUST ATTEMPTED. The app-level cron
--    route's retention sweep (src/lib/google-reviews/sync.ts) only runs
--    when that route runs — if GOOGLE_BUSINESS_PROFILE_* credentials are
--    removed, the app is down, or the route is simply never invoked again,
--    nothing ever deletes aged-out content. expire_stale_google_reviews()
--    below is scheduled on its OWN pg_cron job, pure SQL, with no
--    dependency on the Next.js app, any env var, or Google credentials —
--    it keeps running even if every other part of this feature is torn
--    down. 30 days is hardcoded directly in this function body (confirmed
--    against developers.google.com/my-business/content/policies: "It must
--    be stored temporarily for no more than 30 calendar days") — not an
--    app constant, not an env var, so it cannot be silently widened by
--    configuration.
--
--    This is intentionally scheduled INSIDE this migration, unlike the
--    notification-dispatch/webhook-retry cron jobs, whose cron.schedule()
--    calls are deliberately left as manual per-environment steps — those
--    jobs call out to this app's own HTTP routes with a URL and shared
--    secret that differ per environment and must never be hardcoded into
--    an auto-applied migration. This job calls no URL and needs no
--    secret — it is pure, environment-independent SQL — so there is no
--    reason to defer it, and deferring it would undermine the "guaranteed
--    even if the app is gone" property this whole migration exists for.
--
-- 2. PUBLIC READS MUST NEVER SURFACE EXPIRED CONTENT, EVEN IF THE CLEANUP
--    JOB HASN'T RUN YET TODAY. The two views below push the "last_seen_at
--    within the retention window" / "last_successful_sync_at within the
--    retention window" check into the read path itself, so the homepage
--    can never show a stale review or a stale aggregate rating/count
--    between cleanup runs. The admin screen deliberately does NOT read
--    through these views — it needs to see true, un-filtered sync state
--    (including "this hasn't synced in 40 days") to diagnose a broken
--    integration.
--
-- 3. SYNC WRITES MUST BE ATOMIC AND ORDER-SAFE. apply_google_reviews_sync()
--    does the upsert, the Google-absence reconciliation delete, and the
--    sync_state update in one function call — one Postgres transaction.
--    Any error partway through rolls back everything, so a DB failure
--    mid-sync can never leave a half-applied snapshot (some reviews
--    updated, reconciliation not run, or vice versa). pg_advisory_xact_lock
--    serializes overlapping calls so two concurrent sync attempts can't
--    interleave writes, and the "already have a newer successful sync"
--    check rejects a slow/delayed call from overwriting a result that's
--    already newer than it — both close the "overlapping syncs overwrite
--    newer data" gap. This function is only ever called by sync.ts AFTER
--    a complete successful fetch from Google — a failed/partial fetch
--    never calls it at all, which is what keeps reconciliation distinct
--    from (and never triggered by) a failed fetch; see sync.ts.
-- ============================================================================

-- ---- 1. Independent, DB-internal retention enforcement ---------------------

create or replace function public.expire_stale_google_reviews()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.google_business_profile_reviews
  where last_seen_at < now() - interval '30 days';
end;
$$;

comment on function public.expire_stale_google_reviews() is
  'Deletes any cached review not re-confirmed by a successful sync within 30 days (Google Business Profile content policy''s storage cap). Scheduled on its own pg_cron job (see below) — runs independently of the Next.js app, GOOGLE_BUSINESS_PROFILE_* credentials, and the app-level sync cron route, so content still expires if any/all of those are removed or stop working.';

select cron.schedule(
  'expire-stale-google-reviews',
  '45 7 * * *',
  $$select public.expire_stale_google_reviews();$$
);

-- ---- 2. Public-read views that exclude expired content ---------------------

create or replace view public.public_featured_google_reviews
with (security_invoker = true)
as
select
  fgr.display_order,
  r.id,
  r.reviewer_display_name,
  r.reviewer_photo_url,
  r.star_rating,
  r.review_text,
  r.review_created_at
from public.featured_google_reviews fgr
join public.google_business_profile_reviews r on r.id = fgr.review_id
where r.last_seen_at >= now() - interval '30 days';

comment on view public.public_featured_google_reviews is
  'The only view the homepage reads for cards — excludes any featured review whose cache row has aged past the 30-day retention window, even if expire_stale_google_reviews() has not run yet today. Admin diagnostics bypass this view on purpose (see featured_google_reviews / google_business_profile_reviews directly) to show true state.';

revoke all privileges on public.public_featured_google_reviews from anon, authenticated;
grant select on public.public_featured_google_reviews to service_role;

create or replace view public.public_google_business_profile_rating
with (security_invoker = true)
as
select overall_rating, total_review_count, last_successful_sync_at
from public.google_business_profile_sync_state
where id = 1
  and last_successful_sync_at is not null
  and last_successful_sync_at >= now() - interval '30 days';

comment on view public.public_google_business_profile_rating is
  'Returns zero rows (not stale data) once last_successful_sync_at itself falls outside the retention window — so the homepage stops showing an aggregate rating/count rather than displaying a number nobody has confirmed in over 30 days. Admin diagnostics read google_business_profile_sync_state directly, unfiltered.';

revoke all privileges on public.public_google_business_profile_rating from anon, authenticated;
grant select on public.public_google_business_profile_rating to service_role;

-- ---- 3. Atomic, lock-guarded sync write ------------------------------------

create or replace function public.apply_google_reviews_sync(
  p_sync_started_at timestamptz,
  p_reviews jsonb,
  p_overall_rating numeric,
  p_total_review_count integer
)
returns integer -- number of cached reviews removed by reconciliation
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reconciled_count integer;
begin
  -- Serializes overlapping sync attempts against each other for the
  -- duration of this transaction — a second concurrent call blocks here
  -- until the first commits or rolls back, rather than interleaving writes.
  perform pg_advisory_xact_lock(hashtext('google_business_profile_reviews_sync'));

  -- A slower/delayed call whose fetch started before the currently stored
  -- successful sync must not overwrite that newer result.
  if exists (
    select 1 from public.google_business_profile_sync_state
    where id = 1
      and last_successful_sync_at is not null
      and last_successful_sync_at > p_sync_started_at
  ) then
    raise exception 'google_reviews_sync_superseded: a sync that started later than % already committed', p_sync_started_at
      using errcode = 'P0001';
  end if;

  insert into public.google_business_profile_reviews (
    google_review_id, reviewer_display_name, reviewer_photo_url, star_rating, review_text, review_created_at, review_updated_at, last_seen_at
  )
  select
    r->>'googleReviewId',
    r->>'reviewerDisplayName',
    r->>'reviewerPhotoUrl',
    (r->>'starRating')::smallint,
    r->>'reviewText',
    (r->>'createTime')::timestamptz,
    (r->>'updateTime')::timestamptz,
    p_sync_started_at
  from jsonb_array_elements(p_reviews) as r
  on conflict (google_review_id) do update set
    reviewer_display_name = excluded.reviewer_display_name,
    reviewer_photo_url = excluded.reviewer_photo_url,
    star_rating = excluded.star_rating,
    review_text = excluded.review_text,
    review_updated_at = excluded.review_updated_at,
    last_seen_at = excluded.last_seen_at;

  -- Reconciliation: only reachable after the upsert above succeeded in
  -- this same transaction, and this whole function is only ever called
  -- by sync.ts after a COMPLETE successful fetch — never on a failed or
  -- partial fetch. jsonb_array_elements('[]') correctly yields zero rows,
  -- so an empty p_reviews (Google genuinely has no reviews) deletes
  -- everything cached, which is the correct outcome, not an edge-case bug.
  delete from public.google_business_profile_reviews
  where google_review_id not in (
    select r->>'googleReviewId' from jsonb_array_elements(p_reviews) as r
  );
  get diagnostics v_reconciled_count = row_count;

  update public.google_business_profile_sync_state
  set overall_rating = p_overall_rating,
      total_review_count = p_total_review_count,
      last_successful_sync_at = p_sync_started_at,
      last_sync_attempt_at = p_sync_started_at,
      last_sync_error = null
  where id = 1;

  return v_reconciled_count;
end;
$$;

comment on function public.apply_google_reviews_sync is
  'The only way review upserts, Google-absence reconciliation, and the sync_state aggregate update are ever written — all three in one transaction, so a DB failure partway through rolls back the entire attempt rather than leaving a partial snapshot. Called exclusively from sync.ts, exclusively after a complete successful fetch. Raises errcode P0001 (message prefixed "google_reviews_sync_superseded") when a newer successful sync already committed; sync.ts treats that as a distinct non-error outcome, not a failure to alert on.';

revoke all on function public.apply_google_reviews_sync(timestamptz, jsonb, numeric, integer) from public, anon, authenticated;
grant execute on function public.apply_google_reviews_sync(timestamptz, jsonb, numeric, integer) to service_role;
revoke all on function public.expire_stale_google_reviews() from public, anon, authenticated;
grant execute on function public.expire_stale_google_reviews() to service_role;
-- <<< 20261024091500_harden_google_reviews_sync_and_retention.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261024091500', 'harden_google_reviews_sync_and_retention');

-- >>> 20261031140000_separate_google_reviews_cleanup_schedule_and_harden_sync.sql
-- ============================================================================
-- Migration: separate Google reviews cleanup scheduling from installation,
-- and harden sync reconciliation + featured selection.
--
-- Forward-only. 20261024090000 and 20261024091500 are already applied on
-- Preview and are not rewritten. 20261024091500 both installed
-- expire_stale_google_reviews() and scheduled cron job
-- expire-stale-google-reviews. That coupling would start cleanup on every
-- later environment, including production, the moment the migration ran.
--
-- This migration:
--   1. Unschedules that job if it exists. It does not schedule a replacement.
--      Daily sync and expiry cleanup are manual per-environment steps in
--      docs/google-reviews-activation.md. Apply this file in the same
--      migration group as 20261024091500 so a fresh environment does not
--      keep the job that older file creates.
--   2. Replaces apply_google_reviews_sync with a null-safe NOT EXISTS
--      reconciliation. Malformed ids abort before any write. Skipped ids
--      stay in the fetched-id list, so they are not treated as deletions,
--      and they are removed from the featured set without refreshing
--      last_seen_at.
--   3. Adds set_featured_google_reviews(), one transaction for clear and
--      replace. A failed validation leaves the previous selection.
-- ============================================================================

select cron.unschedule(jobid)
from cron.job
where jobname = 'expire-stale-google-reviews';

drop function if exists public.apply_google_reviews_sync(timestamptz, jsonb, numeric, integer);

create function public.apply_google_reviews_sync(
  p_sync_started_at timestamptz,
  p_reviews jsonb,
  p_fetched_review_ids jsonb,
  p_overall_rating numeric,
  p_total_review_count integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reconciled_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('google_business_profile_reviews_sync'));

  if exists (
    select 1 from public.google_business_profile_sync_state
    where id = 1
      and last_successful_sync_at is not null
      and last_successful_sync_at > p_sync_started_at
  ) then
    raise exception 'google_reviews_sync_superseded'
      using errcode = 'P0001';
  end if;

  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array'
     or p_fetched_review_ids is null or jsonb_typeof(p_fetched_review_ids) <> 'array' then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fetched_review_ids) as element
    where jsonb_typeof(element) <> 'string'
       or nullif(btrim(element #>> '{}'), '') is null
       or btrim(element #>> '{}') !~ '^[A-Za-z0-9_-]{1,512}$'
  ) then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_reviews) as review
    where coalesce(review->>'googleReviewId', '') !~ '^[A-Za-z0-9_-]{1,512}$'
       or coalesce(review->>'starRating', '') !~ '^[1-5]$'
       or not exists (
         select 1
         from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
         where fetched.review_id = review->>'googleReviewId'
       )
  ) then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  insert into public.google_business_profile_reviews (
    google_review_id, reviewer_display_name, reviewer_photo_url, star_rating, review_text, review_created_at, review_updated_at, last_seen_at
  )
  select
    review->>'googleReviewId',
    review->>'reviewerDisplayName',
    review->>'reviewerPhotoUrl',
    (review->>'starRating')::smallint,
    review->>'reviewText',
    (review->>'createTime')::timestamptz,
    (review->>'updateTime')::timestamptz,
    p_sync_started_at
  from jsonb_array_elements(p_reviews) as review
  on conflict (google_review_id) do update set
    reviewer_display_name = excluded.reviewer_display_name,
    reviewer_photo_url = excluded.reviewer_photo_url,
    star_rating = excluded.star_rating,
    review_text = excluded.review_text,
    review_updated_at = excluded.review_updated_at,
    last_seen_at = excluded.last_seen_at;

  -- Skipped ids were fetched but not validated. Drop them from the featured
  -- set without touching the cached row, so last_seen_at is not refreshed
  -- and retention can still expire the stale copy.
  delete from public.featured_google_reviews as featured
  using public.google_business_profile_reviews as cached
  where featured.review_id = cached.id
    and exists (
      select 1
      from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
      where fetched.review_id = cached.google_review_id
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_reviews) as review
      where review->>'googleReviewId' = cached.google_review_id
    );

  delete from public.google_business_profile_reviews as cached
  where not exists (
    select 1
    from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
    where fetched.review_id = cached.google_review_id
  );
  get diagnostics v_reconciled_count = row_count;

  update public.google_business_profile_sync_state
  set overall_rating = p_overall_rating,
      total_review_count = p_total_review_count,
      last_successful_sync_at = p_sync_started_at,
      last_sync_attempt_at = p_sync_started_at,
      last_sync_error = null
  where id = 1;

  return v_reconciled_count;
end;
$$;

comment on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer) is
  'Upserts validated reviews, unfeatures skipped ids without refreshing them, and deletes cached reviews absent from the complete fetched-id list. Malformed ids raise before any write. NOT EXISTS avoids the NULL pitfall of NOT IN. Raises google_reviews_sync_superseded when a newer sync already committed.';

revoke all on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer) from public, anon, authenticated;
grant execute on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer) to service_role;

create function public.set_featured_google_reviews(p_selections jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'featured_reviews_invalid' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_selections);
  if v_count > 5 then
    raise exception 'featured_reviews_limit' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('featured_google_reviews_write'));

  if v_count = 0 then
    delete from public.featured_google_reviews;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_selections) as selection
    where coalesce(selection->>'reviewId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(selection->>'displayOrder', '') !~ '^[1-5]$'
  ) then
    raise exception 'featured_reviews_invalid' using errcode = 'P0001';
  end if;

  if (
    select count(distinct selection->>'reviewId')
    from jsonb_array_elements(p_selections) as selection
  ) <> v_count then
    raise exception 'featured_reviews_duplicate_id' using errcode = 'P0001';
  end if;

  if (
    select count(distinct selection->>'displayOrder')
    from jsonb_array_elements(p_selections) as selection
  ) <> v_count then
    raise exception 'featured_reviews_duplicate_order' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_selections) as selection
    where not exists (
      select 1
      from public.google_business_profile_reviews as review
      join public.google_business_profile_sync_state as sync_state on sync_state.id = 1
      where review.id = (selection->>'reviewId')::uuid
        and sync_state.last_successful_sync_at is not null
        and review.last_seen_at >= sync_state.last_successful_sync_at
        and review.last_seen_at >= now() - interval '30 days'
    )
  ) then
    raise exception 'featured_reviews_ineligible' using errcode = 'P0001';
  end if;

  delete from public.featured_google_reviews;

  insert into public.featured_google_reviews (review_id, display_order)
  select (selection->>'reviewId')::uuid, (selection->>'displayOrder')::smallint
  from jsonb_array_elements(p_selections) as selection;
end;
$$;

comment on function public.set_featured_google_reviews(jsonb) is
  'Replaces the featured Google review selection in one transaction. An empty array clears it. Invalid ids, duplicate order, more than five rows, or a review the latest sync did not validate raise before the delete, and a failed insert rolls the delete back.';

revoke all on function public.set_featured_google_reviews(jsonb) from public, anon, authenticated;
grant execute on function public.set_featured_google_reviews(jsonb) to service_role;
-- <<< 20261031140000_separate_google_reviews_cleanup_schedule_and_harden_sync.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031140000', 'separate_google_reviews_cleanup_schedule_and_harden_sync');

-- >>> 20261031160000_fix_google_review_id_regex_for_postgres.sql
-- ============================================================================
-- Migration: fix Google review-id checks for Postgres POSIX regex limits.
--
-- 20261031140000 is already applied on Preview and is not rewritten.
-- Its apply_google_reviews_sync() checks used '^[A-Za-z0-9_-]{1,512}$'.
-- Postgres rejects a bounded repeat whose upper bound is above 255
-- ("invalid repetition count(s)") when the function runs, so every sync
-- aborted before any write.
--
-- Same signature. Length is checked separately from the character class.
-- CREATE OR REPLACE keeps the existing grants. No cron job is scheduled.
-- ============================================================================

create or replace function public.apply_google_reviews_sync(
  p_sync_started_at timestamptz,
  p_reviews jsonb,
  p_fetched_review_ids jsonb,
  p_overall_rating numeric,
  p_total_review_count integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reconciled_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('google_business_profile_reviews_sync'));

  if exists (
    select 1 from public.google_business_profile_sync_state
    where id = 1
      and last_successful_sync_at is not null
      and last_successful_sync_at > p_sync_started_at
  ) then
    raise exception 'google_reviews_sync_superseded'
      using errcode = 'P0001';
  end if;

  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array'
     or p_fetched_review_ids is null or jsonb_typeof(p_fetched_review_ids) <> 'array' then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fetched_review_ids) as element
    where jsonb_typeof(element) <> 'string'
       or nullif(btrim(element #>> '{}'), '') is null
       or char_length(btrim(element #>> '{}')) > 512
       or btrim(element #>> '{}') !~ '^[A-Za-z0-9_-]+$'
  ) then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_reviews) as review
    where char_length(coalesce(review->>'googleReviewId', '')) > 512
       or coalesce(review->>'googleReviewId', '') !~ '^[A-Za-z0-9_-]+$'
       or coalesce(review->>'starRating', '') !~ '^[1-5]$'
       or not exists (
         select 1
         from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
         where fetched.review_id = review->>'googleReviewId'
       )
  ) then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  insert into public.google_business_profile_reviews (
    google_review_id, reviewer_display_name, reviewer_photo_url, star_rating, review_text, review_created_at, review_updated_at, last_seen_at
  )
  select
    review->>'googleReviewId',
    review->>'reviewerDisplayName',
    review->>'reviewerPhotoUrl',
    (review->>'starRating')::smallint,
    review->>'reviewText',
    (review->>'createTime')::timestamptz,
    (review->>'updateTime')::timestamptz,
    p_sync_started_at
  from jsonb_array_elements(p_reviews) as review
  on conflict (google_review_id) do update set
    reviewer_display_name = excluded.reviewer_display_name,
    reviewer_photo_url = excluded.reviewer_photo_url,
    star_rating = excluded.star_rating,
    review_text = excluded.review_text,
    review_updated_at = excluded.review_updated_at,
    last_seen_at = excluded.last_seen_at;

  delete from public.featured_google_reviews as featured
  using public.google_business_profile_reviews as cached
  where featured.review_id = cached.id
    and exists (
      select 1
      from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
      where fetched.review_id = cached.google_review_id
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_reviews) as review
      where review->>'googleReviewId' = cached.google_review_id
    );

  delete from public.google_business_profile_reviews as cached
  where not exists (
    select 1
    from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
    where fetched.review_id = cached.google_review_id
  );
  get diagnostics v_reconciled_count = row_count;

  update public.google_business_profile_sync_state
  set overall_rating = p_overall_rating,
      total_review_count = p_total_review_count,
      last_successful_sync_at = p_sync_started_at,
      last_sync_attempt_at = p_sync_started_at,
      last_sync_error = null
  where id = 1;

  return v_reconciled_count;
end;
$$;

comment on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer) is
  'Upserts validated reviews, unfeatures skipped ids without refreshing them, and deletes cached reviews absent from the complete fetched-id list. Malformed ids raise before any write. Review-id length is checked separately because Postgres rejects a {1,512} repeat. NOT EXISTS avoids the NULL pitfall of NOT IN. Raises google_reviews_sync_superseded when a newer sync already committed.';

revoke all on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer) from public, anon, authenticated;
grant execute on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer) to service_role;
-- <<< 20261031160000_fix_google_review_id_regex_for_postgres.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031160000', 'fix_google_review_id_regex_for_postgres');

-- >>> 20261031180000_guard_google_reviews_empty_reconciliation.sql
-- ============================================================================
-- Migration: refuse empty Google review reconciliation unless it is an
-- explicitly confirmed zero-review fetch.
--
-- 20261031160000 is already applied and is not rewritten. Its
-- apply_google_reviews_sync() treats an empty fetched-id array as
-- "delete every cached review." A positive totalReviewCount, a truncated
-- page walk, or a malformed payload must not be able to do that.
--
-- This replaces that function with a six-argument version. The old
-- five-argument function is dropped in this file so it cannot be called
-- around the new guard. An empty fetched-id list raises
-- google_reviews_empty_reconciliation_rejected before any write unless
-- p_confirm_empty_reconciliation is true, p_total_review_count is 0, and
-- p_reviews is an empty array. Cache rows, featured selections, and the
-- stored aggregate stay as they were. expire_stale_google_reviews() is
-- unchanged.
--
-- No cron job is scheduled or unscheduled.
-- ============================================================================

drop function if exists public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer);

create function public.apply_google_reviews_sync(
  p_sync_started_at timestamptz,
  p_reviews jsonb,
  p_fetched_review_ids jsonb,
  p_overall_rating numeric,
  p_total_review_count integer,
  p_confirm_empty_reconciliation boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reconciled_count integer;
  v_fetched_count integer;
  v_review_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('google_business_profile_reviews_sync'));

  if exists (
    select 1 from public.google_business_profile_sync_state
    where id = 1
      and last_successful_sync_at is not null
      and last_successful_sync_at > p_sync_started_at
  ) then
    raise exception 'google_reviews_sync_superseded'
      using errcode = 'P0001';
  end if;

  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array'
     or p_fetched_review_ids is null or jsonb_typeof(p_fetched_review_ids) <> 'array' then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  v_fetched_count := jsonb_array_length(p_fetched_review_ids);
  v_review_count := jsonb_array_length(p_reviews);

  if v_fetched_count = 0 then
    if p_confirm_empty_reconciliation is distinct from true
       or p_total_review_count is distinct from 0
       or v_review_count is distinct from 0 then
      raise exception 'google_reviews_empty_reconciliation_rejected' using errcode = 'P0001';
    end if;
  elsif p_confirm_empty_reconciliation is true then
    raise exception 'google_reviews_empty_reconciliation_rejected' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fetched_review_ids) as element
    where jsonb_typeof(element) <> 'string'
       or nullif(btrim(element #>> '{}'), '') is null
       or char_length(btrim(element #>> '{}')) > 512
       or btrim(element #>> '{}') !~ '^[A-Za-z0-9_-]+$'
  ) then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_reviews) as review
    where char_length(coalesce(review->>'googleReviewId', '')) > 512
       or coalesce(review->>'googleReviewId', '') !~ '^[A-Za-z0-9_-]+$'
       or coalesce(review->>'starRating', '') !~ '^[1-5]$'
       or not exists (
         select 1
         from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
         where fetched.review_id = review->>'googleReviewId'
       )
  ) then
    raise exception 'google_reviews_malformed_review_id' using errcode = 'P0001';
  end if;

  insert into public.google_business_profile_reviews (
    google_review_id, reviewer_display_name, reviewer_photo_url, star_rating, review_text, review_created_at, review_updated_at, last_seen_at
  )
  select
    review->>'googleReviewId',
    review->>'reviewerDisplayName',
    review->>'reviewerPhotoUrl',
    (review->>'starRating')::smallint,
    review->>'reviewText',
    (review->>'createTime')::timestamptz,
    (review->>'updateTime')::timestamptz,
    p_sync_started_at
  from jsonb_array_elements(p_reviews) as review
  on conflict (google_review_id) do update set
    reviewer_display_name = excluded.reviewer_display_name,
    reviewer_photo_url = excluded.reviewer_photo_url,
    star_rating = excluded.star_rating,
    review_text = excluded.review_text,
    review_updated_at = excluded.review_updated_at,
    last_seen_at = excluded.last_seen_at;

  delete from public.featured_google_reviews as featured
  using public.google_business_profile_reviews as cached
  where featured.review_id = cached.id
    and exists (
      select 1
      from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
      where fetched.review_id = cached.google_review_id
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_reviews) as review
      where review->>'googleReviewId' = cached.google_review_id
    );

  delete from public.google_business_profile_reviews as cached
  where not exists (
    select 1
    from jsonb_array_elements_text(p_fetched_review_ids) as fetched(review_id)
    where fetched.review_id = cached.google_review_id
  );
  get diagnostics v_reconciled_count = row_count;

  update public.google_business_profile_sync_state
  set overall_rating = p_overall_rating,
      total_review_count = p_total_review_count,
      last_successful_sync_at = p_sync_started_at,
      last_sync_attempt_at = p_sync_started_at,
      last_sync_error = null
  where id = 1;

  return v_reconciled_count;
end;
$$;

comment on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer, boolean) is
  'Upserts validated reviews and deletes cached reviews absent from the complete fetched-id list. An empty fetched-id list raises google_reviews_empty_reconciliation_rejected before any write unless p_confirm_empty_reconciliation is true, the total count is 0, and p_reviews is empty. Malformed ids raise before any write. Raises google_reviews_sync_superseded when a newer sync already committed.';

revoke all on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer, boolean) from public, anon, authenticated;
grant execute on function public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer, boolean) to service_role;
-- <<< 20261031180000_guard_google_reviews_empty_reconciliation.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031180000', 'guard_google_reviews_empty_reconciliation');

-- >>> 20261031200000_fix_featured_google_reviews_delete_for_safeupdate.sql
-- ============================================================================
-- Migration: let set_featured_google_reviews replace rows under pg-safeupdate.
--
-- 20261031180000 is already applied and is not rewritten.
--
-- PostgREST calls this function as service_role. Supabase loads
-- pg-safeupdate for that session, and the extension checks session_user,
-- so a SECURITY DEFINER function owned by a superuser is not exempt.
-- Both deletes below were `delete from public.featured_google_reviews`
-- with no WHERE clause. safeupdate rejects that with SQLSTATE 21000 and
-- message "DELETE requires a WHERE clause", the transaction rolls back,
-- and the previous featured selection stays. Direct SQL as a superuser
-- does not hit the check, which is why the same statement succeeded
-- outside PostgREST.
--
-- Audit of every function body in the Google reviews migrations:
--   expire_stale_google_reviews()
--     DELETE has WHERE last_seen_at < now() - interval '30 days'.
--   apply_google_reviews_sync (live six-argument function)
--     Both DELETEs have a WHERE clause. The sync_state UPDATE has
--     WHERE id = 1. ON CONFLICT DO UPDATE is the insert's conflict
--     action, not a standalone UPDATE.
--   Earlier apply_google_reviews_sync overloads are dropped. Their
--     DELETE and UPDATE statements also had WHERE clauses.
--   set_featured_google_reviews(jsonb)
--     The only bare DELETE or UPDATE in these migrations: the empty-array
--     clear, and the replace that runs before the insert. Both are
--     rewritten here as DELETE ... WHERE true, which safeupdate accepts
--     and which still removes every featured row.
--
-- Signature, SECURITY DEFINER, search_path, and service_role-only execute
-- grant stay the same. No cron job is scheduled or unscheduled.
-- ============================================================================

create or replace function public.set_featured_google_reviews(p_selections jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'featured_reviews_invalid' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_selections);
  if v_count > 5 then
    raise exception 'featured_reviews_limit' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('featured_google_reviews_write'));

  if v_count = 0 then
    delete from public.featured_google_reviews where true;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_selections) as selection
    where coalesce(selection->>'reviewId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(selection->>'displayOrder', '') !~ '^[1-5]$'
  ) then
    raise exception 'featured_reviews_invalid' using errcode = 'P0001';
  end if;

  if (
    select count(distinct selection->>'reviewId')
    from jsonb_array_elements(p_selections) as selection
  ) <> v_count then
    raise exception 'featured_reviews_duplicate_id' using errcode = 'P0001';
  end if;

  if (
    select count(distinct selection->>'displayOrder')
    from jsonb_array_elements(p_selections) as selection
  ) <> v_count then
    raise exception 'featured_reviews_duplicate_order' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_selections) as selection
    where not exists (
      select 1
      from public.google_business_profile_reviews as review
      join public.google_business_profile_sync_state as sync_state on sync_state.id = 1
      where review.id = (selection->>'reviewId')::uuid
        and sync_state.last_successful_sync_at is not null
        and review.last_seen_at >= sync_state.last_successful_sync_at
        and review.last_seen_at >= now() - interval '30 days'
    )
  ) then
    raise exception 'featured_reviews_ineligible' using errcode = 'P0001';
  end if;

  delete from public.featured_google_reviews where true;

  insert into public.featured_google_reviews (review_id, display_order)
  select (selection->>'reviewId')::uuid, (selection->>'displayOrder')::smallint
  from jsonb_array_elements(p_selections) as selection;
end;
$$;

comment on function public.set_featured_google_reviews(jsonb) is
  'Replaces the featured Google review selection in one transaction. An empty array clears it. Deletes use WHERE true so pg-safeupdate allows the statement when PostgREST calls this function. Invalid ids, duplicate order, more than five rows, or a review the latest sync did not validate raise before the delete, and a failed insert rolls the delete back.';

revoke all on function public.set_featured_google_reviews(jsonb) from public, anon, authenticated;
grant execute on function public.set_featured_google_reviews(jsonb) to service_role;
-- <<< 20261031200000_fix_featured_google_reviews_delete_for_safeupdate.sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261031200000', 'fix_featured_google_reviews_delete_for_safeupdate');


do $postcheck$
begin
  if exists (
    select 1
    from cron.job
    where jobname in ('expire-stale-google-reviews', 'sync-google-reviews')
  ) then
    raise exception 'google reviews cron job is visible before commit';
  end if;

  if exists (
    select jobid, jobname, schedule, active
    from pg_temp.google_reviews_apply_cron_baseline
    except
    select jobid, jobname, schedule, active
    from cron.job
    where jobname in (
      'cleanperfecto-notification-dispatch',
      'retry_stuck_webhook_events'
    )
  )
  or exists (
    select jobid, jobname, schedule, active
    from cron.job
    where jobname in (
      'cleanperfecto-notification-dispatch',
      'retry_stuck_webhook_events'
    )
    except
    select jobid, jobname, schedule, active
    from pg_temp.google_reviews_apply_cron_baseline
  ) then
    raise exception 'cleanperfecto-notification-dispatch or retry_stuck_webhook_events changed';
  end if;
end
$postcheck$;

commit;
