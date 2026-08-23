-- ============================================================================
-- Migration: create package_visit_plans table
-- Scheduling + Package Management milestone.
--
-- Lets a prepaid-package customer plan/review all 6 intended cleaning dates
-- upfront (cadence + first date -> 6 proposed dates) WITHOUT those being
-- real service_visits rows — a planned future package visit must never be
-- represented as completed, and must never count toward package credit
-- consumption. A real service_visits row is created/linked only when that
-- specific planned visit actually becomes operationally scheduled/confirmed
-- (status transitions 'planned' -> 'linked').
--
-- status='linked' is deliberately NOT named 'scheduled' — that word already
-- has a precise, different meaning on service_visits.status; reusing it here
-- would make the two tables read as contradictory when joined.
--
-- Reuses service_visits.visit_number once linked; no duplicate column here
-- beyond visit_number itself (needed before a real visit exists, to display
-- "Visit 1 of 6" etc. during planning).
-- ============================================================================

create table public.package_visit_plans (
  id uuid primary key default gen_random_uuid(),

  prepaid_package_id uuid not null references public.prepaid_packages (id),
  visit_number smallint not null check (visit_number > 0),

  planned_date date not null,
  planned_start_time time not null,

  status text not null default 'planned' check (status in ('planned', 'linked')),
  service_visit_id uuid unique references public.service_visits (id),

  generated_from_recurring_schedule_id uuid references public.recurring_schedules (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint package_visit_plans_one_per_visit_number unique (prepaid_package_id, visit_number),
  constraint package_visit_plans_linked_requires_visit check (
    (status = 'planned' and service_visit_id is null)
    or (status = 'linked' and service_visit_id is not null)
  )
);

comment on table public.package_visit_plans is
  'Planning-stage intent for one of a prepaid package''s visits — a proposed date/time, not a real operational appointment. Never represented as completed; completion only ever happens on the linked service_visits row once one exists. See package_visit_plan_history for change history.';

create trigger package_visit_plans_set_updated_at
before update on public.package_visit_plans
for each row execute function public.set_updated_at();

create index package_visit_plans_prepaid_package_id_idx
  on public.package_visit_plans (prepaid_package_id);

alter table public.package_visit_plans enable row level security;

revoke all privileges
on table public.package_visit_plans
from anon, authenticated;

grant select, insert, update
on table public.package_visit_plans
to service_role;
-- No delete grant — a plan's date changes in place (history preserved via
-- package_visit_plan_history), it is never deleted.
