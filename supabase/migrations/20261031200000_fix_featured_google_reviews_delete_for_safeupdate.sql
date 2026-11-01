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
