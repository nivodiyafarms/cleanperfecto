-- ============================================================================
-- Migration: create recurring_schedules table
-- Scheduling + Package Management milestone.
--
-- A recurring_schedules row is a TEMPLATE/PREFERENCE (cadence + preferred
-- day/time), never itself a completed cleaning — service_visits are the
-- generated instances. Applies to either a normal recurring booking
-- (booking_order_id) or a prepaid package (prepaid_package_id), never both.
--
-- "Change this and future visits" = insert a NEW row (supersedes_id points
-- at the row it replaces, with a new effective_from) and mark the OLD row
-- status='superseded' + effective_until = the new row's effective_from.
-- The cadence/day/time on an existing row is never mutated in place — this
-- gives an immutable version chain instead of overwriting history.
-- "Change only this one visit" never touches this table at all; it only
-- edits the one service_visits (or package_visit_plans) row directly.
--
-- Also adds the recurring_schedule_id FK on service_visits, deferred from
-- 20260822090400 since this table didn't exist yet at that point.
-- ============================================================================

create table public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),

  customer_id uuid not null references public.customers (id),
  booking_order_id uuid references public.booking_orders (id),
  prepaid_package_id uuid references public.prepaid_packages (id),

  cadence text not null check (cadence in ('weekly', 'biweekly', 'every_4_weeks')),
  preferred_day_of_week smallint not null check (preferred_day_of_week between 0 and 6),
  preferred_start_time time not null,
  timezone text not null default 'America/Chicago',

  status text not null default 'active'
    check (status in ('active', 'paused', 'superseded', 'cancelled')),

  effective_from date not null,
  effective_until date,

  supersedes_id uuid references public.recurring_schedules (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recurring_schedules_exactly_one_source check (
    (booking_order_id is not null and prepaid_package_id is null)
    or (booking_order_id is null and prepaid_package_id is not null)
  )
);

comment on table public.recurring_schedules is
  'Recurring cadence/day/time TEMPLATE, not a completed cleaning. Exactly one of booking_order_id/prepaid_package_id is set. A "this-and-future" change creates a new row (supersedes_id -> old row) rather than mutating an existing one, preserving full version history.';

comment on column public.recurring_schedules.supersedes_id is
  'Points at the previous version this row replaces, forming an immutable version chain for "change this and future visits." Null for the first version of a customer''s recurring preference.';

create trigger recurring_schedules_set_updated_at
before update on public.recurring_schedules
for each row execute function public.set_updated_at();

create index recurring_schedules_customer_id_idx
  on public.recurring_schedules (customer_id);
create index recurring_schedules_booking_order_id_idx
  on public.recurring_schedules (booking_order_id) where booking_order_id is not null;
create index recurring_schedules_prepaid_package_id_idx
  on public.recurring_schedules (prepaid_package_id) where prepaid_package_id is not null;
create index recurring_schedules_active_idx
  on public.recurring_schedules (status) where status = 'active';

alter table public.recurring_schedules enable row level security;

revoke all privileges
on table public.recurring_schedules
from anon, authenticated;

grant select, insert, update
on table public.recurring_schedules
to service_role;
-- No delete grant — status becomes 'cancelled'/'superseded' instead,
-- preserving the version chain.

-- ---------------------------------------------------------------------------
-- Deferred FK from 20260822090400_extend_service_visits_for_scheduling.sql
-- ---------------------------------------------------------------------------
alter table public.service_visits
  add constraint service_visits_recurring_schedule_id_fkey
  foreign key (recurring_schedule_id) references public.recurring_schedules (id);

comment on column public.service_visits.recurring_schedule_id is
  'Which recurring_schedules version (if any) generated this visit. Null for a one-time visit or a visit created directly without a template.';
