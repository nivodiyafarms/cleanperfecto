-- ============================================================================
-- Migration: create recurring_visit_plan_history table
-- My CleanPerfecto — Customer Portal V1 milestone.
--
-- Append-only log of recurring_visit_plans changes — same rationale and
-- shape as package_visit_plan_history (20260822090800), kept as its own
-- table rather than reused, since it is scoped to the new universal
-- recurring_visit_plans table specifically. recurring_schedule_id is
-- denormalized for the same reason prepaid_package_id is denormalized onto
-- package_visit_plan_history: independently understandable without a join
-- back through recurring_visit_plans.
--
-- change_reason adds one value beyond package_visit_plan_history's set:
-- 'replenishment' — recorded when the rolling six-visit horizon is topped
-- back up after a completed or cancelled occurrence (see
-- replenish-recurring-visit-plans.ts). Package-specific plans never use
-- this reason; only recurring_visit_plans does, since package_visit_plans
-- has a fixed, known-upfront count and is never replenished.
-- ============================================================================

create table public.recurring_visit_plan_history (
  id uuid primary key default gen_random_uuid(),

  recurring_visit_plan_id uuid not null references public.recurring_visit_plans (id),
  recurring_schedule_id uuid not null references public.recurring_schedules (id),
  visit_number smallint not null,

  previous_planned_date date,
  previous_planned_start_time time,
  previous_status text,

  new_planned_date date not null,
  new_planned_start_time time not null,
  new_status text not null,

  change_reason text not null
    check (change_reason in (
      'initial_plan', 'manual_single_move', 'cadence_regeneration',
      'linked_to_visit', 'replenishment'
    )),

  occurred_at timestamptz not null default now()
);

comment on table public.recurring_visit_plan_history is
  'Append-only history of recurring_visit_plans changes. previous_* is null only for change_reason=initial_plan/replenishment (a newly generated row, nothing to compare against). change_reason=linked_to_visit records the planned-to-real transition (dates unchanged, status planned -> linked) when a recurring_visit_plan becomes an actual service_visit.';

create index recurring_visit_plan_history_plan_id_idx
  on public.recurring_visit_plan_history (recurring_visit_plan_id);
create index recurring_visit_plan_history_schedule_id_idx
  on public.recurring_visit_plan_history (recurring_schedule_id);

alter table public.recurring_visit_plan_history enable row level security;

revoke all privileges
on table public.recurring_visit_plan_history
from anon, authenticated;

grant select, insert
on table public.recurring_visit_plan_history
to service_role;
-- Deliberately NO update or delete grant — genuinely append-only, enforced
-- at the DB privilege level, not merely by convention.
