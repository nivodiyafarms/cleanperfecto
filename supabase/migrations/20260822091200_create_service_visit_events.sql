-- ============================================================================
-- Migration: create service_visit_events table
-- Scheduling + Package Management milestone.
--
-- Append-only operational history for a service_visit (requested, confirmed,
-- rescheduled, cleaner assigned/reassigned/unassigned, cancelled, completed,
-- no-access recorded). service_visits itself is the PRESENT state; this
-- table is the historical/audit trail — admin/customer-facing history is
-- reconstructed from these rows, not from overwriting the current row.
-- ============================================================================

create table public.service_visit_events (
  id uuid primary key default gen_random_uuid(),

  service_visit_id uuid not null references public.service_visits (id),

  event_type text not null check (event_type in (
    'requested', 'confirmed', 'rescheduled',
    'cleaner_assigned', 'cleaner_reassigned', 'cleaner_unassigned',
    'cancelled', 'completed', 'no_access_recorded'
  )),

  occurred_at timestamptz not null default now(),
  actor text,

  previous_state jsonb,
  new_state jsonb,
  notes text,

  created_at timestamptz not null default now()
);

comment on table public.service_visit_events is
  'Append-only audit trail of meaningful service_visit lifecycle moments. previous_state/new_state hold whatever fields are relevant to that event_type (e.g. old/new confirmed_start_at for a reschedule), not a full row snapshot. actor is free text for V1 (e.g. "system", "customer", "admin") — no admin-user/auth table exists yet.';

create index service_visit_events_service_visit_id_idx
  on public.service_visit_events (service_visit_id, occurred_at);

alter table public.service_visit_events enable row level security;

revoke all privileges
on table public.service_visit_events
from anon, authenticated;

grant select, insert
on table public.service_visit_events
to service_role;
-- Deliberately NO update or delete grant — genuinely append-only, enforced
-- at the DB privilege level, not merely by convention (stricter than the
-- rest of the schema's usual "no delete" pattern, intentionally so here).
