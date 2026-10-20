-- ============================================================================
-- Migration: claim_and_schedule_recurring_visit_plan() — atomic "schedule
-- this visit" for the universal recurring_visit_plans calendar.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Found during code review of the admin Schedule calendar's "Schedule this
-- visit" feature (PR #9): the application-level sequence (read the plan,
-- check status='planned', INSERT service_visits, UPDATE
-- recurring_visit_plans) was NOT atomic across two separate PostgREST
-- round-trips. Two genuinely concurrent submissions for the SAME plan
-- (two browser tabs, a double-click racing past whatever client-side
-- debounce exists) could both read status='planned' before either write
-- landed, and both proceed to create a service_visits row — only the
-- SECOND write to recurring_visit_plans would "win" (the first visit
-- becomes a silently orphaned duplicate, never referenced by the plan).
--
-- This migration moves the entire claim into one Postgres function. The
-- `select ... for update` row lock on the targeted recurring_visit_plans
-- row is the actual atomicity primitive: a second, genuinely concurrent
-- call blocks on that lock until the first call's transaction commits (or
-- rolls back), at which point it sees status already 'linked' and returns
-- the existing visit rather than ever reaching the insert — so exactly one
-- service_visits row is ever created per plan, enforced by the database,
-- not by application-level sequencing.
--
-- Also closes a second review finding in the same atomic step: verifies
-- the targeted plan's own recurring_schedule_id/customer_id actually match
-- what the caller resolved its scheduling context from, raising a
-- distinct 'plan_schedule_mismatch' exception otherwise — so a mismatched
-- id can never attribute a visit to the wrong customer/schedule, even if
-- some future caller forgets the equivalent (already-added) check in
-- application code.
--
-- Deliberately narrow: only the race-prone core (claim the plan, insert
-- the visit, link them) moves into SQL. recurring_visit_plan_history,
-- service_visit_events, and the package-plan sync
-- (sync-linked-recurring-package-plan.ts) are NOT part of this function —
-- they stay exactly where they already were, in
-- src/lib/scheduling/schedule-recurring-visit-plan.ts, run only by
-- whichever caller this function tells is the genuine winner
-- (already_linked = false). Which prepaid package (if any) currently
-- covers this customer is also resolved in TypeScript beforehand
-- (findActivePrepaidPackageForCustomer) and passed in as a plain
-- parameter — that lookup's own business logic stays in exactly one
-- place, not duplicated into SQL. The Pay Per Cleaning recurring path
-- only; the prepaid-package equivalent (schedulePackageVisitPlan) is
-- explicitly out of scope for this fix.
--
-- Dependencies: requires recurring_visit_plans
-- (20260824100100_create_recurring_visit_plans.sql) and service_visits
-- (plus its later ALTERs adding booking_order_id/prepaid_package_id/
-- recurring_schedule_id/timezone/requested_start_at) to already be
-- applied — matches exactly the column set
-- supabase-scheduling-repository.ts's own insertServiceVisit already
-- writes today.
--
-- Safety: no DROP/TRUNCATE, no data mutation — one new function
-- definition.
-- ============================================================================

create or replace function public.claim_and_schedule_recurring_visit_plan(
  p_recurring_visit_plan_id uuid,
  p_recurring_schedule_id uuid,
  p_customer_id uuid,
  p_prepaid_package_id uuid,
  p_cleaning_type text,
  p_requested_start_at timestamptz,
  p_timezone text,
  p_service_address_line1 text,
  p_service_address_line2 text,
  p_service_city text,
  p_service_state text,
  p_service_address_identity text
)
returns table (visit_id uuid, already_linked boolean)
language plpgsql
set search_path = public
as $$
declare
  v_plan public.recurring_visit_plans;
  v_visit_id uuid;
begin
  -- The row lock itself is the atomicity guarantee: held for the rest of
  -- THIS transaction, so a second concurrent call blocks here until this
  -- one commits or rolls back.
  select * into v_plan from public.recurring_visit_plans where id = p_recurring_visit_plan_id for update;
  if v_plan.id is null then
    raise exception 'recurring_visit_plan_not_found';
  end if;

  if v_plan.recurring_schedule_id is distinct from p_recurring_schedule_id
    or v_plan.customer_id is distinct from p_customer_id
  then
    raise exception 'plan_schedule_mismatch';
  end if;

  if v_plan.status = 'linked' then
    -- Already claimed — either a genuine prior call, or a concurrent
    -- caller that just committed while we waited on the lock above.
    -- Create nothing; return what already exists.
    return query select v_plan.service_visit_id, true;
    return;
  end if;

  -- status = 'planned' (the only other value the check constraint
  -- allows) — we are the sole winner of the lock; claim it now.
  insert into public.service_visits (
    customer_id, quote_request_id, booking_order_id, prepaid_package_id,
    recurring_schedule_id, visit_number, cleaning_type, frequency,
    status, requested_start_at, timezone,
    service_address_line1, service_address_line2, service_city, service_state, service_address_identity
  ) values (
    p_customer_id, null, null, p_prepaid_package_id,
    v_plan.recurring_schedule_id, v_plan.visit_number, p_cleaning_type, null,
    'requested', p_requested_start_at, p_timezone,
    p_service_address_line1, p_service_address_line2, p_service_city, p_service_state, p_service_address_identity
  )
  returning id into v_visit_id;

  update public.recurring_visit_plans
  set status = 'linked', service_visit_id = v_visit_id
  where id = p_recurring_visit_plan_id;

  return query select v_visit_id, false;
end;
$$;

comment on function public.claim_and_schedule_recurring_visit_plan(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, text) is
  'Atomic "schedule this visit" for a planned recurring_visit_plans occurrence: locks the targeted plan row (select ... for update — the actual mutual-exclusion guarantee against a genuine concurrent double-submit), verifies it belongs to the given schedule/customer (raises plan_schedule_mismatch otherwise), and — only if still status=planned — inserts the real service_visits row and links the plan to it in the same transaction. Returns the existing visit (already_linked=true) when the plan was already linked, whether from a prior call or a concurrent winner. recurring_visit_plan_history/service_visit_events/package-plan sync are deliberately NOT part of this function — see src/lib/scheduling/schedule-recurring-visit-plan.ts, the sole caller, which runs those only on the genuine-winner path.';

revoke all on function public.claim_and_schedule_recurring_visit_plan(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function public.claim_and_schedule_recurring_visit_plan(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, text)
to service_role;
