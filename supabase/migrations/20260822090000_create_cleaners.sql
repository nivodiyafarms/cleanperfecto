-- ============================================================================
-- Migration: create cleaners table
-- Scheduling + Package Management milestone.
--
-- CleanPerfecto mixes different cleaners on different jobs (no fixed crews),
-- so a cleaner is an independent scheduling resource, not part of a fixed
-- team. This table intentionally holds no payroll fields — it exists only to
-- give the scheduling engine an identity to assign/track availability
-- against. See service_visit_assignments for the many-to-many link to
-- service_visits.
-- ============================================================================

create table public.cleaners (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cleaners is
  'Individual cleaner records. No fixed crews — cleaners are mixed and matched per job via service_visit_assignments. No payroll/compensation data lives here.';

create trigger cleaners_set_updated_at
before update on public.cleaners
for each row execute function public.set_updated_at();

create index cleaners_active_idx on public.cleaners (active) where active = true;

alter table public.cleaners enable row level security;

revoke all privileges
on table public.cleaners
from anon, authenticated;

grant select, insert, update
on table public.cleaners
to service_role;
-- No delete grant — deactivate (active = false) instead of deleting, so
-- historical assignments/events keep a valid cleaner reference.
