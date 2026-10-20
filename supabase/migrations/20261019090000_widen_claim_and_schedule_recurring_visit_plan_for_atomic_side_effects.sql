-- ============================================================================
-- Migration: widen claim_and_schedule_recurring_visit_plan() to include
-- history/event/package-sync in the SAME atomic transaction.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Found during a follow-up review of 20261018090800: that migration made
-- the core claim (lock plan row, insert service_visits, link the plan)
-- atomic, but left recurring_visit_plan_history / service_visit_events /
-- the package-plan sync as separate TypeScript steps run AFTER the claim
-- transaction had already committed (see schedule-recurring-visit-plan.ts).
-- If any of those three threw (transient network/DB error), the visit was
-- already created and the plan already linked, but a retry would see
-- status='linked' and short-circuit on already_linked=true WITHOUT ever
-- retrying the missing history/event/sync writes — a permanently
-- incomplete audit trail and, for a package-linked plan, a package
-- calendar that silently fell out of sync with no automatic recovery.
--
-- Fix: move all three into this same function, inside the same
-- transaction/row lock as the claim itself. Now the claim is genuinely
-- all-or-nothing — either everything commits together (visit + plan link
-- + history + event + package sync), or the whole transaction rolls back
-- and the plan is left exactly as it was (status='planned'), so a retry
-- redoes the full claim from scratch rather than resuming a partial state.
-- The already_linked=true branch is therefore now ALSO correct by
-- construction: if a plan reads as 'linked', every one of these writes is
-- guaranteed to have already happened for it, by the same transaction that
-- set that status. No separate idempotent-retry bookkeeping is needed
-- because there is no longer any window where the claim can partially
-- succeed.
--
-- Package-plan sync here reproduces (in SQL, scoped to this one atomic
-- step only) the exact comparison/update/history-insert shape of
-- sync-linked-recurring-package-plan.ts's syncPackagePlanFromRecurringPlan:
-- a no-op when no package_visit_plans row links to this recurring plan, or
-- when the two sides already agree. It does not touch, call, or change any
-- other package-specific code path (schedulePackageVisitPlan,
-- replanPackageCadence, replanPackageVisit, etc.) — those remain exactly
-- as they were; this is additive only, inside the one function the Pay Per
-- Cleaning "schedule this visit" action already calls exclusively.
--
-- No new grants needed: this function is SECURITY INVOKER (runs as the
-- calling role, service_role), and service_role already holds select+
-- insert on recurring_visit_plan_history/service_visit_events/
-- package_visit_plan_history and select+insert+update on
-- package_visit_plans (granted when those tables were created).
--
-- Safety: no DROP/TRUNCATE, no data mutation by this migration itself —
-- one function replaced (create or replace), identical signature/
-- return type, strictly additive body behavior for a winning claim; the
-- mismatch-rejection and already-linked-return behavior are unchanged.
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
  v_package_plan public.package_visit_plans;
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
    -- By construction (see this transaction's own body below), every
    -- history/event/package-sync write for that prior claim already
    -- committed along with it. Create nothing; return what already exists.
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

  -- Audit: recurring_visit_plan_history (planned -> linked transition).
  -- Same shape as schedule-recurring-visit-plan.ts's prior (now removed)
  -- insertRecurringVisitPlanHistory call, just inside this transaction.
  insert into public.recurring_visit_plan_history (
    recurring_visit_plan_id, recurring_schedule_id, visit_number,
    previous_planned_date, previous_planned_start_time, previous_status,
    new_planned_date, new_planned_start_time, new_status, change_reason
  ) values (
    v_plan.id, v_plan.recurring_schedule_id, v_plan.visit_number,
    v_plan.planned_date, v_plan.planned_start_time, v_plan.status,
    v_plan.planned_date, v_plan.planned_start_time, 'linked', 'linked_to_visit'
  );

  -- Audit: service_visit_events 'requested' event. Same shape as the
  -- prior (now removed) insertServiceVisitEvent call.
  insert into public.service_visit_events (
    service_visit_id, event_type, actor, previous_state, new_state, notes
  ) values (
    v_visit_id, 'requested', 'system', null,
    jsonb_build_object(
      'requestedStartAt', p_requested_start_at,
      'recurringVisitPlanId', v_plan.id,
      'prepaidPackageId', p_prepaid_package_id
    ),
    null
  );

  -- Package-plan sync: if this universal plan is linked to a
  -- package_visit_plans row, bring it into agreement in the SAME
  -- transaction. Mirrors sync-linked-recurring-package-plan.ts's
  -- syncPackagePlanFromRecurringPlan exactly (no-op when no link exists or
  -- the two sides already agree) — every OTHER caller of that TypeScript
  -- function (replanRecurringVisit, replanRecurringCadence, the reverse
  -- package-to-recurring direction, etc.) is untouched by this migration.
  select * into v_package_plan
  from public.package_visit_plans
  where recurring_visit_plan_id = v_plan.id
  for update;

  if v_package_plan.id is not null
    and (
      v_package_plan.planned_date is distinct from v_plan.planned_date
      or v_package_plan.planned_start_time is distinct from v_plan.planned_start_time
      or v_package_plan.status is distinct from 'linked'
      or v_package_plan.service_visit_id is distinct from v_visit_id
    )
  then
    insert into public.package_visit_plan_history (
      package_visit_plan_id, prepaid_package_id, visit_number,
      previous_planned_date, previous_planned_start_time, previous_status,
      new_planned_date, new_planned_start_time, new_status, change_reason, package_amendment_id
    ) values (
      v_package_plan.id, v_package_plan.prepaid_package_id, v_package_plan.visit_number,
      v_package_plan.planned_date, v_package_plan.planned_start_time, v_package_plan.status,
      v_plan.planned_date, v_plan.planned_start_time, 'linked', 'linked_to_visit', null
    );

    update public.package_visit_plans
    set planned_date = v_plan.planned_date,
        planned_start_time = v_plan.planned_start_time,
        status = 'linked',
        service_visit_id = v_visit_id
    where id = v_package_plan.id;
  end if;

  return query select v_visit_id, false;
end;
$$;

comment on function public.claim_and_schedule_recurring_visit_plan(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, text) is
  'Atomic "schedule this visit" for a planned recurring_visit_plans occurrence: locks the targeted plan row (select ... for update), verifies it belongs to the given schedule/customer (raises plan_schedule_mismatch otherwise), and — only if still status=planned — inserts the real service_visits row, links the plan to it, records recurring_visit_plan_history + service_visit_events, and syncs any linked package_visit_plans row, ALL in this one transaction. Returns the existing visit (already_linked=true) when the plan was already linked, whether from a prior call or a concurrent winner — by construction every audit/sync write for that prior claim already committed with it, so there is nothing left to retry.';

revoke all on function public.claim_and_schedule_recurring_visit_plan(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function public.claim_and_schedule_recurring_visit_plan(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, text, text)
to service_role;
