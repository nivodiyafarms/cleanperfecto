-- ============================================================================
-- Migration: add work_finished state and Finalize & Send support
-- Finalize & Send Customer Payment Flow milestone.
--
-- Problem: service_visit_pricing is frozen the instant service_visits.status
-- reaches 'completed' (protect_service_visit_pricing_after_completion,
-- 20260824100400). But physically finishing a cleaning and having an admin
-- review/finalize the exact scope+price are two different events in time —
-- the admin needs a window, after the cleaner is done, to still adjust scope
-- (estimateVisitPricing) before pricing freezes. This migration inserts a
-- new 'work_finished' status between 'scheduled' and 'completed' to
-- represent exactly that window. It is purely additive/widening:
--   - existing rows are untouched (none are currently 'work_finished')
--   - complete_service_visit(uuid) is widened to accept a visit already in
--     'work_finished', in addition to its existing 'scheduled' guard, so
--     every existing direct scheduled->completed caller (e.g. the prepaid
--     package "Mark completed" button) keeps working unchanged
--   - a new mark_service_visit_work_finished(uuid) RPC mirrors
--     complete_service_visit's exact idempotent status-guarded-UPDATE shape
-- ============================================================================

alter table public.service_visits
  add column work_finished_at timestamptz;

comment on column public.service_visits.work_finished_at is
  'Set when the cleaner marks the physical cleaning done (mark_service_visit_work_finished RPC), before admin has necessarily finalized scope/pricing. Distinct from completed_at, which only occurs once pricing is frozen via Finalize & Send (or, for non-priced-review flows, immediately). Only a status=''work_finished'' visit is eligible for admin scope changes via estimateVisitPricing.';

alter table public.service_visits
  drop constraint service_visits_status_timestamps_consistent;

alter table public.service_visits
  drop constraint service_visits_status_check;

alter table public.service_visits
  add constraint service_visits_status_check
  check (status in ('requested', 'scheduled', 'work_finished', 'completed', 'cancelled'));

alter table public.service_visits
  add constraint service_visits_status_timestamps_consistent check (
    (
      status = 'requested'
      and confirmed_at is null and confirmed_start_at is null and confirmed_end_at is null
      and work_finished_at is null and completed_at is null and cancelled_at is null
    )
    or (
      status = 'scheduled'
      and work_finished_at is null and completed_at is null and cancelled_at is null
      -- confirmed_* is intentionally NOT required non-null here — see
      -- 20260822090400's migration header comment on why (pre-existing rows).
    )
    or (
      status = 'work_finished'
      and work_finished_at is not null and completed_at is null and cancelled_at is null
    )
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
  );

comment on constraint service_visits_status_timestamps_consistent on public.service_visits is
  'requested requires no confirmation/completion/cancellation data at all. work_finished sits between scheduled and completed: work_finished_at set, but not yet completed/cancelled — this is the window in which admin may still revise scope/pricing (estimateVisitPricing) before Finalize & Send freezes it. scheduled/work_finished/completed/cancelled remain mutually exclusive on their timestamp columns. confirmed_* is application-enforced (not DB-required) for scheduled, to stay valid against pre-existing rows created before the scheduling milestone.';

-- ---------------------------------------------------------------------------
-- mark_service_visit_work_finished: idempotent scheduled -> work_finished
-- transition, mirroring complete_service_visit's exact shape. No package
-- credit is consumed here — that still only happens at actual completion
-- (complete_service_visit), which Finalize & Send calls once pricing is
-- resolved.
-- ---------------------------------------------------------------------------
create or replace function public.mark_service_visit_work_finished(p_service_visit_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  update service_visits
  set status = 'work_finished', work_finished_at = now()
  where id = p_service_visit_id
    and status = 'scheduled';
end;
$$;

comment on function public.mark_service_visit_work_finished(uuid) is
  'Idempotent scheduled -> work_finished transition (cleaner/admin marks the physical cleaning done). Safe no-op if the visit is already work_finished/completed or not currently scheduled — caller inspects current status if it needs to distinguish them.';

revoke all on function public.mark_service_visit_work_finished(uuid)
from public, anon, authenticated;

grant execute on function public.mark_service_visit_work_finished(uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- complete_service_visit: widen the guard to also accept a visit already in
-- 'work_finished' (Finalize & Send's normal path), in addition to the
-- existing direct 'scheduled' -> 'completed' path (unchanged callers, e.g.
-- the prepaid package "Mark completed" button). Everything else about this
-- function — the idempotent no-op-if-0-rows shape, the package credit
-- consumption — is unchanged from 20260822091400.
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
    and status in ('scheduled', 'work_finished');

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
  'Idempotent completion: at most one package_visit_usages row (and therefore at most one remaining_visit_count decrement) is ever created per service_visit, even under concurrent/duplicate retry. No-ops safely if the visit is already completed or not currently scheduled/work_finished. Accepts either scheduled (legacy direct path) or work_finished (Finalize & Send path) as its starting state.';

-- ---------------------------------------------------------------------------
-- service_visit_events: add 'work_finished' and 'final_total_sent' event
-- types, following the same additive-widening precedent as 20260824100500.
-- ---------------------------------------------------------------------------
alter table public.service_visit_events
  drop constraint service_visit_events_event_type_check;

alter table public.service_visit_events
  add constraint service_visit_events_event_type_check
  check (event_type in (
    'requested', 'confirmed', 'rescheduled', 'reschedule_requested',
    'cleaner_assigned', 'cleaner_reassigned', 'cleaner_unassigned',
    'cancelled', 'completed', 'no_access_recorded',
    'work_finished', 'final_total_sent'
  ));

-- ---------------------------------------------------------------------------
-- service_visit_notifications: add 'final_total_ready', following the same
-- additive-widening precedent as 20260828100100.
-- ---------------------------------------------------------------------------
alter table public.service_visit_notifications
  drop constraint service_visit_notifications_notification_type_check;

alter table public.service_visit_notifications
  add constraint service_visit_notifications_notification_type_check
  check (notification_type in (
    'reminder_24h',
    'appointment_confirmed',
    'rescheduled',
    'cancelled',
    'completed',
    'pricing_approval_required',
    'consent_required',
    'consent_reminder',
    'review_request',
    'payment_succeeded',
    'payment_failed',
    'payment_action_required',
    'final_total_ready'
  ));
