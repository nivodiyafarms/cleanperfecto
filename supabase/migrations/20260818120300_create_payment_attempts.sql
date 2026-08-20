-- ============================================================================
-- Migration: create payment_attempts table
-- Booking + Payment Phase 1 (owner-approved).
--
-- One row per Stripe Checkout Session created for a booking_orders row.
-- A booking order can have more than one attempt over time (an expired or
-- failed session is retried with a fresh session on the same booking
-- order — see repository "find active attempt, else create new" logic),
-- but never more than one *open* attempt at once.
--
-- Depends on public.booking_orders.
-- ============================================================================

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),

  booking_order_id uuid not null references public.booking_orders (id),

  mode text not null check (mode in ('setup', 'payment')),

  stripe_checkout_session_id text not null unique,
  stripe_customer_id text,
  stripe_setup_intent_id text,
  stripe_payment_intent_id text,

  -- Null for mode='setup' (no charge). Set for mode='payment' from the
  -- server-authoritative prepaid_package_total at attempt-creation time —
  -- never re-derived from a client value.
  amount numeric(10, 2),
  currency text not null default 'usd',

  -- 'processing' covers the async-payment-method window: a
  -- checkout.session.completed event with payment_status != "paid" lands
  -- here until the corresponding async_payment_succeeded/failed event
  -- arrives. See webhook/process-stripe-webhook-event.ts.
  status text not null default 'created'
    check (status in ('created', 'processing', 'completed', 'expired', 'canceled', 'failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_attempts is
  'One row per Stripe Checkout Session attempt for a booking order. status is driven exclusively by verified webhook events (see webhook/process-stripe-webhook-event.ts) — never by the success/cancel redirect page.';

comment on column public.payment_attempts.amount is
  'Null for mode=setup. For mode=payment, the exact server-calculated prepaid package subtotal at attempt-creation time (pre-tax — Stripe Tax adds the tax line at Checkout; this column never includes it).';

create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row execute function public.set_updated_at();

create index payment_attempts_booking_order_id_idx
  on public.payment_attempts (booking_order_id);
create index payment_attempts_booking_order_open_idx
  on public.payment_attempts (booking_order_id)
  where status in ('created', 'processing');

alter table public.payment_attempts enable row level security;

revoke all privileges
on table public.payment_attempts
from anon, authenticated;

grant select, insert, update
on table public.payment_attempts
to service_role;
-- No delete grant — a failed/expired attempt is a status, not a deletion;
-- the retry history stays visible.
