-- ============================================================================
-- Migration: create package_amendments table
-- Scheduling + Package Management milestone.
--
-- Records an admin-initiated change to an ACTIVE prepaid package's cadence
-- for its REMAINING/unused visits only — completed visits are never
-- retroactively repriced. Pricing is always recomputed via the existing
-- server-authoritative calculateEstimate() (src/lib/pricing/calculate-estimate.ts)
-- against the remaining visit count and the new cadence; this table never
-- duplicates or invents pricing math.
--
-- Financial rule: a higher new amount requires the customer's explicit
-- approval AND completed additional payment before the amendment takes
-- effect (approval_state/payment_state below) — never a silent extra
-- charge. A lower new amount produces an explicit refund/credit record —
-- never a silent shrink of the original package total. Either way, the
-- original prepaid_packages/payment_attempts history is never overwritten;
-- this table is a new, separate record of the change.
--
-- Also adds the deferred package_amendment_id FK on
-- package_visit_plan_history (that table was created first since
-- package_amendments references its own recurring_schedules version via
-- new_recurring_schedule_id, and needed recurring_schedules to exist first).
-- ============================================================================

create table public.package_amendments (
  id uuid primary key default gen_random_uuid(),

  prepaid_package_id uuid not null references public.prepaid_packages (id),

  old_cadence text not null check (old_cadence in ('weekly', 'biweekly', 'every_4_weeks')),
  new_cadence text not null check (new_cadence in ('weekly', 'biweekly', 'every_4_weeks')),
  effective_from_visit_number smallint not null check (effective_from_visit_number > 0),

  remaining_visit_count_at_amendment smallint not null check (remaining_visit_count_at_amendment >= 0),
  old_remaining_value numeric(10, 2) not null,
  new_remaining_value numeric(10, 2) not null,
  value_difference numeric(10, 2) not null,

  pricing_snapshot jsonb not null,
  new_recurring_schedule_id uuid references public.recurring_schedules (id),

  reason text,
  approval_state text not null default 'pending_customer_approval'
    check (approval_state in ('pending_customer_approval', 'approved', 'rejected')),
  payment_state text not null default 'not_required'
    check (payment_state in (
      'not_required', 'additional_payment_pending', 'additional_payment_completed',
      'refund_pending', 'refund_completed', 'credit_issued'
    )),

  initiated_by_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.package_amendments is
  'One row per cadence-change request against an active prepaid package''s remaining visits. Completed visits are never repriced. value_difference > 0 means additional balance owed (requires approval_state=approved AND payment_state=additional_payment_completed before applying); value_difference < 0 means a refund/credit is owed (payment_state moves to refund_pending/refund_completed/credit_issued). pricing_snapshot is the full { input, result } from calculateEstimate(), same shape as booking_orders.pricing_snapshot.';

comment on column public.package_amendments.initiated_by_note is
  'Free-text actor reference for V1 — no admin-user/auth table exists yet in this repo. Not a FK; revisit once an admin identity system exists.';

-- Freeze pricing/value fields once approval_state leaves
-- 'pending_customer_approval', mirroring
-- protect_booking_order_pricing_snapshot() in
-- 20260818120200_create_booking_orders.sql.
create or replace function public.protect_package_amendment_pricing()
returns trigger
language plpgsql
as $$
begin
  if old.approval_state <> 'pending_customer_approval' then
    if new.pricing_snapshot is distinct from old.pricing_snapshot
      or new.old_remaining_value is distinct from old.old_remaining_value
      or new.new_remaining_value is distinct from old.new_remaining_value
      or new.value_difference is distinct from old.value_difference
      or new.old_cadence is distinct from old.old_cadence
      or new.new_cadence is distinct from old.new_cadence
    then
      raise exception
        'package_amendments pricing fields are immutable once approval_state has left pending_customer_approval (id=%). Create a new amendment instead of modifying a decided one.',
        old.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_package_amendment_pricing() is
  'BEFORE UPDATE guard: once approval_state has moved past pending_customer_approval (approved or rejected), rejects any change to the pricing/value fields or old/new cadence. approval_state/payment_state themselves and other workflow fields remain updatable.';

create trigger package_amendments_protect_pricing
before update on public.package_amendments
for each row execute function public.protect_package_amendment_pricing();

create trigger package_amendments_set_updated_at
before update on public.package_amendments
for each row execute function public.set_updated_at();

create index package_amendments_prepaid_package_id_idx
  on public.package_amendments (prepaid_package_id);

alter table public.package_amendments enable row level security;

revoke all privileges
on table public.package_amendments
from anon, authenticated;

grant select, insert, update
on table public.package_amendments
to service_role;
-- No delete grant — a rejected amendment stays as history (approval_state
-- = 'rejected'), never removed.

-- ---------------------------------------------------------------------------
-- Deferred FK from 20260822090800_create_package_visit_plan_history.sql
-- ---------------------------------------------------------------------------
alter table public.package_visit_plan_history
  add constraint package_visit_plan_history_amendment_id_fkey
  foreign key (package_amendment_id) references public.package_amendments (id);
