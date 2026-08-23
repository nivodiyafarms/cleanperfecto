-- ============================================================================
-- Migration: create recurring_visit_plans table
-- My CleanPerfecto — Customer Portal V1 milestone.
--
-- The UNIVERSAL rolling "next six cleanings" planning layer for every active
-- recurring_schedules row — Pay Per Cleaning AND prepaid-package customers
-- alike. Owner-approved correction: the customer-facing calendar must not
-- depend on payment model, so this table is keyed by recurring_schedule_id
-- (which already covers both booking_order_id- and prepaid_package_id-
-- backed schedules — see recurring_schedules_exactly_one_source), never by
-- prepaid_package_id directly.
--
-- package_visit_plans (20260822090700) is NOT altered or superseded by this
-- migration — it remains intact for backward compatibility and existing
-- package fulfillment history/admin tooling. It is simply no longer the
-- table the customer portal reads/writes for a package customer's calendar;
-- this table is. For a package customer, the two are seeded with the same
-- initial dates at package activation and may drift thereafter if the
-- customer self-serves a change through the portal — package_visit_plans
-- stays a point-in-time admin fulfillment record, not a live mirror. This is
-- a deliberate, additive-only choice to avoid touching already-validated
-- package code (see the domain functions' own doc comments for detail).
--
-- Whether a specific occurrence draws a prepaid-package credit is NOT
-- decided by this table at all — it's resolved dynamically, at the moment a
-- 'planned' row here is turned into a real service_visits row (see
-- schedule-recurring-visit-plan.ts), by checking the customer's currently
-- active prepaid_packages balance. Once that balance is exhausted, later
-- rows under the very same recurring_schedule_id simply produce Pay Per
-- Cleaning visits instead — the schedule/calendar is the constant; payment
-- model is a per-visit financial fact layered on top (service_visits.
-- prepaid_package_id, already nullable per-visit in the existing schema).
--
-- Same shape/lifecycle as package_visit_plans deliberately: 'planned' means
-- nothing operational exists yet (no service_visits row); 'linked' means a
-- real service_visits row now exists and this plan's date lives there
-- instead. A planned visit_number is scoped to ONE recurring_schedule_id
-- version's own generation batch (see recurring_visit_plan_history's
-- 'cadence_regeneration'/'replenishment' reasons) — it is never a
-- lifetime-continuous counter; the customer-visible "Visit 1..6" ordinal is
-- always computed at read time (order by planned_date across whatever is
-- currently live), never trusted from this column across a cadence change.
-- ============================================================================

create table public.recurring_visit_plans (
  id uuid primary key default gen_random_uuid(),

  recurring_schedule_id uuid not null references public.recurring_schedules (id),
  customer_id uuid not null references public.customers (id),

  visit_number smallint not null check (visit_number > 0),

  planned_date date not null,
  planned_start_time time not null,

  status text not null default 'planned' check (status in ('planned', 'linked')),
  service_visit_id uuid unique references public.service_visits (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recurring_visit_plans_one_per_schedule_visit_number unique (recurring_schedule_id, visit_number),
  constraint recurring_visit_plans_linked_requires_visit check (
    (status = 'planned' and service_visit_id is null)
    or (status = 'linked' and service_visit_id is not null)
  )
);

comment on table public.recurring_visit_plans is
  'Universal rolling next-six-cleanings planning layer for every active recurring_schedules row, regardless of payment model. A row here is not a real appointment until status=''linked'' and service_visit_id is set — see schedule-recurring-visit-plan.ts. customer_id is denormalized (same rationale as service_visits.service_address_identity) for a direct customer-ownership check without joining through recurring_schedules.';

comment on column public.recurring_visit_plans.customer_id is
  'Denormalized from recurring_schedules.customer_id at creation time — lets a portal action verify ownership (recurring_visit_plans.customer_id = the authenticated customer) directly, without a join.';

create trigger recurring_visit_plans_set_updated_at
before update on public.recurring_visit_plans
for each row execute function public.set_updated_at();

create index recurring_visit_plans_recurring_schedule_id_idx
  on public.recurring_visit_plans (recurring_schedule_id);
create index recurring_visit_plans_customer_id_idx
  on public.recurring_visit_plans (customer_id);

alter table public.recurring_visit_plans enable row level security;

revoke all privileges
on table public.recurring_visit_plans
from anon, authenticated;

grant select, insert, update
on table public.recurring_visit_plans
to service_role;
-- No delete grant — a plan's date changes in place (history preserved via
-- recurring_visit_plan_history), it is never deleted.
