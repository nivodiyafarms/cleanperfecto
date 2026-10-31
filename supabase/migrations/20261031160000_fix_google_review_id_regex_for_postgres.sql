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
