-- ============================================================================
-- Migration: create package_visit_plan_history table
-- Scheduling + Package Management milestone.
--
-- Append-only log of package_visit_plans changes (initial plan creation,
-- a single manual move, or a cadence-driven regeneration of remaining
-- plans) — preserves the history the spec explicitly requires ("Preserve
-- the history of previous planned dates/schedule versions") without
-- overloading service_visit_events, which is scoped to real service_visits
-- rows only (every row there has a real, non-null service_visit_id FK).
-- prepaid_package_id is denormalized onto this table for the same reason
-- service_visits snapshots its own service address: independently
-- understandable without a join back through package_visit_plans.
-- ============================================================================

create table public.package_visit_plan_history (
  id uuid primary key default gen_random_uuid(),

  package_visit_plan_id uuid not null references public.package_visit_plans (id),
  prepaid_package_id uuid not null references public.prepaid_packages (id),
  visit_number smallint not null,

  previous_planned_date date,
  previous_planned_start_time time,
  previous_status text,

  new_planned_date date not null,
  new_planned_start_time time not null,
  new_status text not null,

  change_reason text not null
    check (change_reason in ('initial_plan', 'manual_single_move', 'cadence_regeneration', 'linked_to_visit')),
  package_amendment_id uuid, -- FK added in 20260822091000 once package_amendments exists

  occurred_at timestamptz not null default now()
);

comment on table public.package_visit_plan_history is
  'Append-only history of package_visit_plans changes. previous_* is null only for change_reason=initial_plan (the plan''s first row, nothing to compare against). change_reason=linked_to_visit records the planned-to-real transition (dates unchanged, status planned -> linked) when a package_visit_plan becomes an actual service_visit. package_amendment_id is set when the change was driven by a cadence amendment rather than a manual single-visit move.';

create index package_visit_plan_history_plan_id_idx
  on public.package_visit_plan_history (package_visit_plan_id);
create index package_visit_plan_history_prepaid_package_id_idx
  on public.package_visit_plan_history (prepaid_package_id);

alter table public.package_visit_plan_history enable row level security;

revoke all privileges
on table public.package_visit_plan_history
from anon, authenticated;

grant select, insert
on table public.package_visit_plan_history
to service_role;
-- Deliberately NO update or delete grant — genuinely append-only, enforced
-- at the DB privilege level, not merely by convention.
