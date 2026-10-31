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
