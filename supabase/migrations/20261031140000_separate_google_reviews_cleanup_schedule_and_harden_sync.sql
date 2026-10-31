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
