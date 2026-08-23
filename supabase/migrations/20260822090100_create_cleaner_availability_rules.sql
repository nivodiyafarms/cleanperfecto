-- ============================================================================
-- Migration: create cleaner_availability_rules table
-- Scheduling + Package Management milestone.
--
-- Recurring weekly availability per cleaner (e.g. "Cleaner A, Monday,
-- 8:00 AM-6:00 PM"). Deliberately NOT a pre-generated calendar of daily rows
-- — the availability engine (src/lib/scheduling/availability.ts) evaluates
-- these rules dynamically for a requested date. cleaner_availability_exceptions
-- (next migration) overrides these rules for a specific date.
-- ============================================================================

create table public.cleaner_availability_rules (
  id uuid primary key default gen_random_uuid(),

  cleaner_id uuid not null references public.cleaners (id),

  -- 0 = Sunday .. 6 = Saturday, matching JS Date.getDay().
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cleaner_availability_rules_end_after_start check (end_time > start_time)
);

comment on table public.cleaner_availability_rules is
  'Recurring weekly availability per cleaner. No uniqueness on (cleaner_id, day_of_week) — split shifts on the same day are allowed (multiple rows). Overridden per-date by cleaner_availability_exceptions.';

create trigger cleaner_availability_rules_set_updated_at
before update on public.cleaner_availability_rules
for each row execute function public.set_updated_at();

create index cleaner_availability_rules_cleaner_day_idx
  on public.cleaner_availability_rules (cleaner_id, day_of_week) where active = true;

alter table public.cleaner_availability_rules enable row level security;

revoke all privileges
on table public.cleaner_availability_rules
from anon, authenticated;

grant select, insert, update
on table public.cleaner_availability_rules
to service_role;
-- No delete grant — deactivate (active = false) instead of deleting.
