-- ============================================================================
-- Migration: create cleaner_availability_exceptions table
-- Scheduling + Package Management milestone.
--
-- Date-specific overrides to a cleaner's recurring availability (vacation,
-- one-off unavailability, extended/shortened hours for a single date).
-- Cleanly overrides cleaner_availability_rules for that date: the
-- availability engine checks exceptions first and, when one exists for the
-- requested date, uses it INSTEAD OF the recurring rule rather than
-- combining the two.
--
-- V1 supports exactly one override block per cleaner per date (matches the
-- spec's own examples — "unavailable all day" or one custom-hours window).
-- Split custom-hours-with-a-gap on a single date is not supported yet.
-- ============================================================================

create table public.cleaner_availability_exceptions (
  id uuid primary key default gen_random_uuid(),

  cleaner_id uuid not null references public.cleaners (id),
  exception_date date not null,

  type text not null check (type in ('unavailable_all_day', 'custom_hours')),
  start_time time,
  end_time time,

  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cleaner_availability_exceptions_hours_match_type check (
    (type = 'unavailable_all_day' and start_time is null and end_time is null)
    or (type = 'custom_hours' and start_time is not null and end_time is not null and end_time > start_time)
  ),
  constraint cleaner_availability_exceptions_one_per_cleaner_date unique (cleaner_id, exception_date)
);

comment on table public.cleaner_availability_exceptions is
  'Date-specific override of a cleaner''s recurring availability (cleaner_availability_rules). One row per cleaner per date. type=unavailable_all_day means no availability that date regardless of recurring rules; type=custom_hours replaces (not adds to) the recurring window for that date.';

create trigger cleaner_availability_exceptions_set_updated_at
before update on public.cleaner_availability_exceptions
for each row execute function public.set_updated_at();

create index cleaner_availability_exceptions_cleaner_date_idx
  on public.cleaner_availability_exceptions (cleaner_id, exception_date);

alter table public.cleaner_availability_exceptions enable row level security;

revoke all privileges
on table public.cleaner_availability_exceptions
from anon, authenticated;

grant select, insert, update
on table public.cleaner_availability_exceptions
to service_role;
-- No delete grant — an exception can be superseded by updating it in place
-- (it's a scheduling override, not history that must be preserved forever).
