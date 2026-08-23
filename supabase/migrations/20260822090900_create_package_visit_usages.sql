-- ============================================================================
-- Migration: create package_visit_usages table
-- Scheduling + Package Management milestone.
--
-- Idempotent ledger recording exactly which service_visits consumed a
-- prepaid package credit. Package credit decreases ONLY when a service_visit
-- reaches 'completed' — never on scheduling, confirmation, rescheduling, or
-- cancellation. service_visit_id UNIQUE is the core idempotency guarantee:
-- a retried/duplicate "mark completed" operation can insert this row at
-- most once per visit, so complete_service_visit() (see
-- 20260822091400_create_scheduling_rpc_functions.sql) can never
-- double-decrement prepaid_packages.remaining_visit_count even under retry.
-- This mirrors the existing "status guard + independent unique constraint"
-- two-layer idempotency pattern already used for Stripe webhook processing
-- and prepaid_packages.booking_order_id.
-- ============================================================================

create table public.package_visit_usages (
  id uuid primary key default gen_random_uuid(),

  prepaid_package_id uuid not null references public.prepaid_packages (id),
  service_visit_id uuid not null unique references public.service_visits (id),
  visit_number smallint,

  consumed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.package_visit_usages is
  'One row per completed prepaid-package visit that has consumed a credit. service_visit_id UNIQUE guarantees at-most-once consumption per visit, independent of any application-level guard — see complete_service_visit().';

create index package_visit_usages_prepaid_package_id_idx
  on public.package_visit_usages (prepaid_package_id);

alter table public.package_visit_usages enable row level security;

revoke all privileges
on table public.package_visit_usages
from anon, authenticated;

grant select, insert
on table public.package_visit_usages
to service_role;
-- No update/delete grant — a usage record is an immutable fact once
-- created; never modified or removed.
