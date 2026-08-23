-- ============================================================================
-- Migration: create service_fee_assessments table
-- Scheduling + Package Management milestone.
--
-- Records a cancellation/rescheduling/no-access fee OBLIGATION per the
-- existing approved policy (src/lib/booking/cancellation-policy.ts:
-- 48+ hrs free, 24-48 hrs $25, <24 hrs $50, dispatched/no-access $75).
-- Deliberately separate from service_visit_events ("what happened") — this
-- table is "what financial consequence resulted." This milestone only
-- RECORDS the obligation; it does not perform any real charge (Stripe stays
-- sandbox-only; actual post-cleaning/fee charging is not built yet, matching
-- the existing project note for normal-booking charging).
-- ============================================================================

create table public.service_fee_assessments (
  id uuid primary key default gen_random_uuid(),

  service_visit_id uuid not null references public.service_visits (id),

  fee_type text not null check (fee_type in ('reschedule', 'cancellation', 'no_access')),
  amount numeric(10, 2) not null check (amount >= 0),
  policy_version text not null,
  reason text,

  assessed_at timestamptz not null default now(),
  state text not null default 'assessed' check (state in ('assessed', 'waived', 'paid', 'void')),

  payment_attempt_id uuid references public.payment_attempts (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_fee_assessments is
  'Records the fee obligation (not the charge itself) for a late reschedule/cancellation/no-access event on a service_visit, per cancellation-policy.ts. policy_version pins CANCELLATION_POLICY_VERSION at assessment time. payment_attempt_id is a future linkage once real off-session fee charging is built — null for this milestone.';

create trigger service_fee_assessments_set_updated_at
before update on public.service_fee_assessments
for each row execute function public.set_updated_at();

create index service_fee_assessments_service_visit_id_idx
  on public.service_fee_assessments (service_visit_id);
create index service_fee_assessments_state_idx
  on public.service_fee_assessments (state) where state = 'assessed';

alter table public.service_fee_assessments enable row level security;

revoke all privileges
on table public.service_fee_assessments
from anon, authenticated;

grant select, insert, update
on table public.service_fee_assessments
to service_role;
-- No delete grant — a waived fee becomes state='waived', never removed.
