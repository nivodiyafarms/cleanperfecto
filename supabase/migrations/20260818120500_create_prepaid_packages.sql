-- ============================================================================
-- Migration: create prepaid_packages table
-- Booking + Payment Phase 1 (owner-approved).
--
-- One row per 6+ visit prepaid package purchase, created only after a
-- webhook verifies the payment actually succeeded (never from the
-- checkout return/success page — see webhook/process-stripe-webhook-event.ts).
-- Does NOT create any service_visits rows: dates are scheduled later, by
-- a future milestone, one visit at a time.
--
-- Depends on public.customers and public.booking_orders.
-- ============================================================================

create table public.prepaid_packages (
  id uuid primary key default gen_random_uuid(),

  customer_id uuid not null references public.customers (id),
  booking_order_id uuid not null unique references public.booking_orders (id),

  frequency text not null
    check (frequency in ('weekly', 'biweekly', 'every_4_weeks')),

  purchased_visit_count integer not null default 6 check (purchased_visit_count >= 6),
  remaining_visit_count integer not null default 6 check (remaining_visit_count >= 0),

  -- The exact amount actually charged (subtotal the customer paid,
  -- inclusive of whatever Stripe Tax collected at checkout) and the
  -- resulting per-cleaning average — both server-derived from the
  -- verified Stripe payment, never a client value.
  package_total_paid numeric(10, 2) not null,
  effective_price_per_visit numeric(10, 2) not null,

  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),

  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prepaid_packages is
  'One row per verified, fully-paid 6+ visit prepaid package. remaining_visit_count is decremented later (future milestone) as individual visits are scheduled/completed — this milestone only ever inserts it at 6 and never creates service_visits rows itself.';

comment on column public.prepaid_packages.booking_order_id is
  'unique — activation is `insert ... on conflict (booking_order_id) do nothing`, so a duplicate webhook delivery or reprocessed event can never create two packages for the same booking order.';

create trigger prepaid_packages_set_updated_at
before update on public.prepaid_packages
for each row execute function public.set_updated_at();

create index prepaid_packages_customer_id_idx
  on public.prepaid_packages (customer_id);

alter table public.prepaid_packages enable row level security;

revoke all privileges
on table public.prepaid_packages
from anon, authenticated;

grant select, insert, update
on table public.prepaid_packages
to service_role;
-- No delete grant — cancellation is a status, not a deletion.
