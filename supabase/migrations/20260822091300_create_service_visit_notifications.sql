-- ============================================================================
-- Migration: create service_visit_notifications table
-- Scheduling + Package Management milestone.
--
-- Foundation for a single ~24-hour-before-cleaning reminder per confirmed
-- service_visit. This migration provides the DATA MODEL and the row
-- lifecycle only (create-on-confirm, cancel-and-replace-on-reschedule) —
-- see src/lib/scheduling/schedule-visit-reminder.ts. No dispatch/cron
-- mechanism is built in this milestone: this repo has no existing
-- background-job/cron infrastructure, and adding one is a new, separate
-- piece of infra beyond scheduling's foundation. channel='sms' is modeled
-- for a future channel but no SMS provider integration exists yet — do not
-- assume it is implemented from this column alone.
-- ============================================================================

create table public.service_visit_notifications (
  id uuid primary key default gen_random_uuid(),

  service_visit_id uuid not null references public.service_visits (id),

  notification_type text not null default 'reminder_24h' check (notification_type in ('reminder_24h')),
  channel text not null check (channel in ('email', 'sms')),

  scheduled_send_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'sent', 'cancelled', 'failed')),
  sent_at timestamptz,
  failure_reason text,
  retry_count smallint not null default 0,

  -- Includes channel and the confirmed_start_at this reminder was computed
  -- from, so a reschedule naturally mints a new key while the old pending
  -- row for the previous confirmed time gets explicitly cancelled (never
  -- silently orphaned) — see cancel-pending-reminder.ts.
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_visit_notifications is
  'One row per reminder attempt for a confirmed service_visit. idempotency_key = "{service_visit_id}:{notification_type}:{channel}:{confirmed_start_at_iso}" prevents duplicate reminders for the same confirmed schedule version. A reschedule before send cancels the stale pending row and creates a fresh one for the new confirmed_start_at. No send dispatcher exists yet in this milestone — state stays pending until a future cron/dispatcher is built.';

create trigger service_visit_notifications_set_updated_at
before update on public.service_visit_notifications
for each row execute function public.set_updated_at();

create index service_visit_notifications_service_visit_id_idx
  on public.service_visit_notifications (service_visit_id);
create index service_visit_notifications_pending_due_idx
  on public.service_visit_notifications (scheduled_send_at) where state = 'pending';

alter table public.service_visit_notifications enable row level security;

revoke all privileges
on table public.service_visit_notifications
from anon, authenticated;

grant select, insert, update
on table public.service_visit_notifications
to service_role;
-- No delete grant — a stale reminder becomes state='cancelled', never
-- removed, preserving the notification history.
