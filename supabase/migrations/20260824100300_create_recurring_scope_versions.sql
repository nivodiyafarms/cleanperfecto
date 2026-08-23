-- ============================================================================
-- Migration: create recurring_scope_versions table
-- My CleanPerfecto — Customer Portal V1 milestone.
--
-- A small, versioned record of a recurring relationship's BASE CLEANING
-- SCOPE (bedrooms/bathrooms/condition/cleaning type/etc — the server-
-- authoritative CalculationInput the pricing engine needs) and its
-- currently-approved base amount, kept deliberately separate from
-- recurring_schedules. recurring_schedules stays exactly what it already
-- is — cadence/day/time only — never overloaded with cleaning-scope
-- history; scope changes (e.g. "one more bedroom now", "Standard -> Deep")
-- are a materially different kind of change from a cadence/day/time change
-- and get their own version chain here.
--
-- Same versioning idiom as recurring_schedules' own supersedes_id chain:
-- a scope change never mutates an existing row in place — it inserts a new
-- row (supersedes_id -> the row it replaces) and marks the old row
-- status='superseded'. Nothing here ever rewrites a completed visit's
-- pricing; only FUTURE visits scheduled/estimated after a version becomes
-- 'active' use it.
--
-- Approval mirrors package_amendments' own financial-approval convention
-- (owner-approved elsewhere in this schema): a proposed version starts
-- 'pending_customer_approval'; approved_base_amount/pricing_snapshot are
-- only trusted once status='active'. No amount is ever silently increased
-- without this row moving to 'active' first — see
-- approve-recurring-scope-change.ts.
-- ============================================================================

create table public.recurring_scope_versions (
  id uuid primary key default gen_random_uuid(),

  recurring_schedule_id uuid not null references public.recurring_schedules (id),
  customer_id uuid not null references public.customers (id),

  base_calculation_input jsonb not null,
  approved_base_amount numeric(10, 2),
  pricing_snapshot jsonb,

  status text not null default 'pending_customer_approval'
    check (status in ('pending_customer_approval', 'active', 'superseded', 'rejected')),

  effective_from_visit_number smallint not null check (effective_from_visit_number > 0),
  supersedes_id uuid references public.recurring_scope_versions (id),

  requested_by text,
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.recurring_scope_versions is
  'Versioned base cleaning-scope + server-authoritative pricing input for a recurring relationship, kept separate from recurring_schedules (cadence/day/time only). Each new scope change is a new row (supersedes_id chain), never an in-place edit — completed visits keep whatever scope version was active for them at the time, unaffected by later versions. approved_base_amount/pricing_snapshot are only meaningful once status=''active''.';

comment on column public.recurring_scope_versions.base_calculation_input is
  'A CalculationInput snapshot (property/rooms/condition/cleaning type/etc, same shape as booking_orders.pricing_snapshot.input) — the frozen scope this version reprices FROM. Frequency/visitCount/addOnIds are resolved fresh per visit at estimate time, never trusted from this snapshot.';

comment on column public.recurring_scope_versions.requested_by is
  'Free-text actor tag (e.g. "customer:<customer_account_id>", "admin:<admin_user_id>") — no generalized actor FK exists in this schema yet, same convention as package_amendments.initiated_by_note.';

create trigger recurring_scope_versions_set_updated_at
before update on public.recurring_scope_versions
for each row execute function public.set_updated_at();

create index recurring_scope_versions_recurring_schedule_id_idx
  on public.recurring_scope_versions (recurring_schedule_id);
create index recurring_scope_versions_active_idx
  on public.recurring_scope_versions (recurring_schedule_id)
  where status = 'active';

alter table public.recurring_scope_versions enable row level security;

revoke all privileges
on table public.recurring_scope_versions
from anon, authenticated;

grant select, insert, update
on table public.recurring_scope_versions
to service_role;
-- No delete grant — a rejected/superseded version stays as history, never
-- removed, same convention as package_amendments.
