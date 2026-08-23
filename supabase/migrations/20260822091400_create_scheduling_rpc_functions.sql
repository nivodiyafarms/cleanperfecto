-- ============================================================================
-- Migration: create scheduling RPC functions
-- Scheduling + Package Management milestone.
--
-- supabase-js has no client-side multi-statement transaction API, and two
-- operations here genuinely need atomic multi-row writes. This is a narrow,
-- justified extension of the existing trigger-function pattern already used
-- in this schema (set_updated_at, protect_booking_order_pricing_snapshot,
-- protect_package_amendment_pricing) — a callable function instead of a
-- trigger, not a new access-control paradigm. Both functions:
--   - are called only via the service-role admin client (src/lib/supabase/admin.ts),
--     which already bypasses RLS on every table — so SECURITY INVOKER
--     (the default) is used, not SECURITY DEFINER, which would only add an
--     unnecessary privilege-escalation surface for zero benefit here
--   - pin search_path explicitly (standard Postgres/Supabase hardening)
--   - get the exact same revoke-then-grant-to-service_role treatment as
--     every table in this schema, applied to EXECUTE instead of table DML
-- ============================================================================

-- ---------------------------------------------------------------------------
-- set_service_visit_schedule: single atomic entry point for confirming,
-- rescheduling, or reassigning a service_visit. Updates the visit's
-- confirmed_* fields + status, unassigns any active cleaner not in the new
-- cleaner set, updates buffered_range on kept assignments, and inserts new
-- assignment rows for newly-added cleaners. If the service_visit_assignments
-- EXCLUDE constraint (service_visit_assignments_no_overlap) rejects an
-- insert/update as an overlap, Postgres raises exclusion_violation
-- (SQLSTATE 23P01), which aborts this entire function's transaction — a
-- multi-cleaner job can never end up confirmed with only some of its
-- required cleaners actually reserved.
-- ---------------------------------------------------------------------------
create or replace function public.set_service_visit_schedule(
  p_service_visit_id uuid,
  p_confirmed_start_at timestamptz,
  p_confirmed_end_at timestamptz,
  p_estimated_labor_minutes integer,
  p_estimated_service_minutes integer,
  p_recommended_cleaner_count smallint,
  p_turnaround_buffer_minutes integer,
  p_cleaner_ids uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_updated_count integer;
  v_buffered_range tstzrange;
begin
  if coalesce(array_length(p_cleaner_ids, 1), 0) = 0 then
    raise exception 'set_service_visit_schedule requires at least one cleaner (service_visit_id=%)', p_service_visit_id;
  end if;

  if p_confirmed_end_at <= p_confirmed_start_at then
    raise exception 'confirmed_end_at must be after confirmed_start_at (service_visit_id=%)', p_service_visit_id;
  end if;

  v_buffered_range := tstzrange(
    p_confirmed_start_at,
    p_confirmed_end_at + (p_turnaround_buffer_minutes || ' minutes')::interval,
    '[)'
  );

  update service_visits
  set
    confirmed_at = now(),
    confirmed_start_at = p_confirmed_start_at,
    confirmed_end_at = p_confirmed_end_at,
    estimated_labor_minutes = p_estimated_labor_minutes,
    estimated_service_minutes = p_estimated_service_minutes,
    recommended_cleaner_count = p_recommended_cleaner_count,
    turnaround_buffer_minutes = p_turnaround_buffer_minutes,
    status = 'scheduled'
  where id = p_service_visit_id
    and status in ('requested', 'scheduled');

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'service_visit % is not in a confirmable state (must be requested or scheduled)', p_service_visit_id;
  end if;

  -- Unassign any currently-active cleaner not in the new set.
  update service_visit_assignments
  set unassigned_at = now()
  where service_visit_id = p_service_visit_id
    and unassigned_at is null
    and cleaner_id <> all (p_cleaner_ids);

  -- Refresh buffered_range on cleaners kept from before (timing/buffer may
  -- have changed on a reschedule). Safe against the EXCLUDE constraint: it
  -- only compares rows sharing the same cleaner_id, and a visit cannot have
  -- two active rows for the same cleaner (see the partial unique index),
  -- so no row here can collide with another row in this same statement.
  update service_visit_assignments
  set buffered_range = v_buffered_range
  where service_visit_id = p_service_visit_id
    and unassigned_at is null
    and cleaner_id = any (p_cleaner_ids);

  -- Insert newly-added cleaners. This is the statement where a genuine
  -- double-booking conflict with a DIFFERENT visit is caught by the
  -- EXCLUDE constraint and raises exclusion_violation.
  insert into service_visit_assignments (service_visit_id, cleaner_id, buffered_range)
  select p_service_visit_id, c.id, v_buffered_range
  from unnest(p_cleaner_ids) as c (id)
  where not exists (
    select 1
    from service_visit_assignments sva
    where sva.service_visit_id = p_service_visit_id
      and sva.cleaner_id = c.id
      and sva.unassigned_at is null
  );
end;
$$;

comment on function public.set_service_visit_schedule(uuid, timestamptz, timestamptz, integer, integer, smallint, integer, uuid[]) is
  'Atomic confirm/reschedule/reassign entry point. Raises exclusion_violation (23P01) on a genuine cleaner double-booking, aborting the whole call — never a partial multi-cleaner write. Domain code (src/lib/scheduling/confirm-service-visit.ts etc.) catches 23P01 and reports "slot no longer available."';

revoke all on function public.set_service_visit_schedule(uuid, timestamptz, timestamptz, integer, integer, smallint, integer, uuid[])
from public, anon, authenticated;

grant execute on function public.set_service_visit_schedule(uuid, timestamptz, timestamptz, integer, integer, smallint, integer, uuid[])
to service_role;

-- ---------------------------------------------------------------------------
-- complete_service_visit: atomically transitions an eligible visit to
-- 'completed' and, if it belongs to a prepaid package, consumes exactly one
-- package credit. Idempotent by construction (the status-guarded UPDATE
-- means a retried call after the first success is a safe no-op that never
-- reaches the credit-consumption steps), with
-- package_visit_usages.service_visit_id UNIQUE as a second, independent
-- backstop — the same two-layer idempotency pattern already used for
-- Stripe webhook processing in this codebase, applied to a new mechanism.
-- ---------------------------------------------------------------------------
create or replace function public.complete_service_visit(p_service_visit_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_updated_count integer;
  v_prepaid_package_id uuid;
  v_visit_number smallint;
begin
  update service_visits
  set status = 'completed', completed_at = now()
  where id = p_service_visit_id
    and status = 'scheduled';

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    -- Already completed (safe idempotent no-op) or not in a completable
    -- state (requested/cancelled). Either way, no further action here —
    -- the caller inspects current status if it needs to distinguish them.
    return;
  end if;

  select prepaid_package_id, visit_number
  into v_prepaid_package_id, v_visit_number
  from service_visits
  where id = p_service_visit_id;

  if v_prepaid_package_id is not null then
    insert into package_visit_usages (prepaid_package_id, service_visit_id, visit_number)
    values (v_prepaid_package_id, p_service_visit_id, v_visit_number)
    on conflict (service_visit_id) do nothing;

    if found then
      update prepaid_packages
      set remaining_visit_count = remaining_visit_count - 1
      where id = v_prepaid_package_id
        and remaining_visit_count > 0;
    end if;
  end if;
end;
$$;

comment on function public.complete_service_visit(uuid) is
  'Idempotent completion: at most one package_visit_usages row (and therefore at most one remaining_visit_count decrement) is ever created per service_visit, even under concurrent/duplicate retry. No-ops safely if the visit is already completed or not currently scheduled.';

revoke all on function public.complete_service_visit(uuid)
from public, anon, authenticated;

grant execute on function public.complete_service_visit(uuid)
to service_role;
