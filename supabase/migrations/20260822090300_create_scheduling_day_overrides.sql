-- ============================================================================
-- Migration: create scheduling_day_overrides table
-- Scheduling + Package Management milestone.
--
-- Business-level scheduling control, independent of any individual cleaner's
-- availability (cleaner_availability_rules/exceptions). Supports closing a
-- date entirely (e.g. a holiday) or blocking part of a date to new
-- appointments (e.g. "Aug 30, no new bookings 8 AM-12 PM").
--
-- IMPORTANT: there is no 'full' value anywhere in this table's type check.
-- "Full" (no remaining capacity) is never stored — it is always a dynamic
-- finding of the availability engine (src/lib/scheduling/availability.ts)
-- computed from actual cleaner availability and existing confirmed
-- assignments. This table only ever represents an admin's deliberate
-- decision to restrict scheduling, which is a different concept from the
-- engine simply finding no open slots.
-- ============================================================================

create table public.scheduling_day_overrides (
  id uuid primary key default gen_random_uuid(),

  override_date date not null,
  type text not null check (type in ('closed_all_day', 'partial_block')),
  block_start_time time,
  block_end_time time,

  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint scheduling_day_overrides_block_matches_type check (
    (type = 'closed_all_day' and block_start_time is null and block_end_time is null)
    or (type = 'partial_block' and block_start_time is not null and block_end_time is not null and block_end_time > block_start_time)
  )
);

comment on table public.scheduling_day_overrides is
  'Admin-controlled business-level scheduling restrictions, independent of cleaner availability. Never stores a "full" state — that is always computed dynamically by the availability engine. Multiple partial_block rows are allowed per date (e.g. two separate blocked windows); only one closed_all_day row is allowed per date (see the partial unique index below).';

create trigger scheduling_day_overrides_set_updated_at
before update on public.scheduling_day_overrides
for each row execute function public.set_updated_at();

create unique index scheduling_day_overrides_one_full_closure_per_date
  on public.scheduling_day_overrides (override_date) where type = 'closed_all_day';

create index scheduling_day_overrides_date_idx
  on public.scheduling_day_overrides (override_date);

alter table public.scheduling_day_overrides enable row level security;

revoke all privileges
on table public.scheduling_day_overrides
from anon, authenticated;

grant select, insert, update
on table public.scheduling_day_overrides
to service_role;
-- No delete grant — remove a restriction by leaving it in place with
-- historical value, or by admin process outside this milestone's scope;
-- avoiding delete keeps the table consistent with every other table's
-- history-preserving convention.
