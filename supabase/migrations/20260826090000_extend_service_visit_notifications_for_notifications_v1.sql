-- ============================================================================
-- Migration: extend service_visit_notifications for Notifications V1
-- Notifications V1 milestone.
--
-- Purely additive extension of the existing table (created
-- 20260822091300_create_service_visit_notifications.sql) — no parallel
-- notification ledger is introduced. Widens the row lifecycle from
-- "reminder-only bookkeeping" to "the one unified, dispatchable delivery
-- ledger" for every V1 notification type.
--
-- service_visit_id stays NOT NULL: no V1 notification type is package-level
-- rather than visit-level (package activation/amendment already have their
-- own success-email and approval workflow — see the architecture decision
-- record), so there is no concrete need yet to make this nullable or add a
-- second source column. Revisit only if/when a real package-level
-- notification type is approved.
-- ============================================================================

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
    'pricing_approval_required'
  ));

alter table public.service_visit_notifications
  drop constraint service_visit_notifications_state_check;

alter table public.service_visit_notifications
  add constraint service_visit_notifications_state_check
  check (state in ('pending', 'sending', 'sent', 'cancelled', 'failed'));

-- Denormalized for admin queries/reporting without joining through
-- service_visits every time — same rationale as recurring_visit_plans and
-- recurring_visit_plan_history denormalizing recurring_schedule_id.
alter table public.service_visit_notifications
  add column customer_id uuid references public.customers (id);

update public.service_visit_notifications n
set customer_id = sv.customer_id
from public.service_visits sv
where sv.id = n.service_visit_id
  and n.customer_id is null;

alter table public.service_visit_notifications
  alter column customer_id set not null;

-- Provider's own message id (Resend/Twilio), for tracing and future
-- delivery-webhook reconciliation. Null until a send attempt returns one.
alter table public.service_visit_notifications
  add column provider_message_id text;

-- The claim/attempt timestamp: set when a row transitions pending -> sending
-- (see claim_due_service_visit_notifications below). Lets a stale claim
-- (dispatcher process crashed mid-send, row stuck in 'sending' forever) be
-- safely reclaimed after a lease window, instead of ever silently assuming
-- an uncertain provider result was a success.
alter table public.service_visit_notifications
  add column claimed_at timestamptz;

comment on table public.service_visit_notifications is
  'One row per notification attempt (reminder or event-driven) for a service_visit. idempotency_key prevents duplicate rows for the same logical notification. state: pending -> sending -> sent, or pending -> sending -> failed -> pending (retry, capped) -> failed (terminal). claimed_at supports safe recovery of a row stuck in ''sending'' after a dispatcher crash — see claim_due_service_visit_notifications().';

-- Supports the dispatcher's stale-'sending'-row reclaim path.
create index service_visit_notifications_sending_claimed_idx
  on public.service_visit_notifications (claimed_at)
  where state = 'sending';

create index service_visit_notifications_customer_id_idx
  on public.service_visit_notifications (customer_id);

-- ---------------------------------------------------------------------------
-- claim_due_service_visit_notifications: atomic claim step for the
-- dispatcher (see src/lib/notifications/dispatch-due-notifications.ts).
-- Claims BOTH due-pending rows and stale-'sending' rows (a prior claim whose
-- worker never finished) in one statement, using FOR UPDATE SKIP LOCKED so
-- two concurrent dispatcher invocations (e.g. an overlapping Supabase Cron
-- tick, or a manual disposable-validation call racing the real cron) can
-- never claim the same row twice. Mirrors this schema's existing atomic-RPC
-- convention (set_service_visit_schedule, complete_service_visit) rather
-- than a client-side select-then-update, which would be race-prone.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_service_visit_notifications(
  p_limit integer,
  p_stale_minutes integer
)
returns setof public.service_visit_notifications
language plpgsql
set search_path = public
as $$
begin
  return query
    with claimable as (
      select id
      from service_visit_notifications
      where (state = 'pending' and scheduled_send_at <= now())
         or (state = 'sending' and claimed_at is not null and claimed_at < now() - make_interval(mins => p_stale_minutes))
      order by scheduled_send_at asc
      limit p_limit
      for update skip locked
    )
    update service_visit_notifications n
    set state = 'sending', claimed_at = now()
    from claimable
    where n.id = claimable.id
    returning n.*;
end;
$$;

comment on function public.claim_due_service_visit_notifications(integer, integer) is
  'Atomically claims up to p_limit due-pending or stale-sending (older than p_stale_minutes) notification rows, marking them sending with a fresh claimed_at. FOR UPDATE SKIP LOCKED makes concurrent dispatcher invocations mutually exclusive per row — never a double-send.';

revoke all on function public.claim_due_service_visit_notifications(integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_due_service_visit_notifications(integer, integer)
to service_role;
