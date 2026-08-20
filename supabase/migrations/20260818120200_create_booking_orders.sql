-- ============================================================================
-- Migration: create booking_orders table
-- Booking + Payment Phase 1 (owner-approved).
--
-- One row per customer booking decision made from a completed quote —
-- either a normal one-time/recurring cleaning (payment method saved, not
-- charged) or a 6+ visit prepaid package (charged in full via Stripe).
-- This table, payment_attempts, and prepaid_packages are the source of
-- truth for this milestone; quote_requests is read (see the prior SELECT
-- grant migration) but never written by this or any later booking code.
--
-- Depends on public.customers and public.quote_requests.
-- ============================================================================

create table public.booking_orders (
  id uuid primary key default gen_random_uuid(),

  customer_id uuid not null references public.customers (id),
  quote_request_id uuid not null references public.quote_requests (id),

  -- One row per distinct customer submission, generated client-side once
  -- per visit to the booking page and resent unchanged on every retry of
  -- that same submission (double click, slow network, page reload before
  -- navigation). Insert is `on conflict (client_request_id) do nothing`;
  -- a conflict means "this exact submission already produced a row" and
  -- the existing row is reused rather than a second one being created.
  -- A genuinely different selection gets a new token by revisiting the
  -- booking page.
  client_request_id text not null unique,

  booking_type text not null
    check (booking_type in ('normal', 'prepaid_package')),

  cleaning_type text not null
    check (cleaning_type in ('standard', 'deep', 'move')),
  frequency text not null
    check (frequency in ('one_time', 'weekly', 'biweekly', 'every_4_weeks')),

  visit_count integer not null check (visit_count > 0),
  constraint booking_orders_visit_count_matches_type check (
    (booking_type = 'normal' and visit_count = 1)
    or (booking_type = 'prepaid_package' and visit_count >= 6)
  ),

  -- This milestone's code only ever sets draft -> awaiting_payment_method
  -- | awaiting_payment -> pending_confirmation | payment_completed.
  -- cancelled/confirmed are reserved for future admin/scheduling work so
  -- this CHECK doesn't need widening later.
  status text not null default 'draft'
    check (
      status in (
        'draft', 'awaiting_payment_method', 'awaiting_payment',
        'payment_completed', 'pending_confirmation', 'cancelled', 'confirmed'
      )
    ),

  -- Explicit, affirmative "save my card" authorization — separate from,
  -- and not a substitute for, the future cleaning/photo/video consent
  -- form. Required for a normal booking (which only saves a payment
  -- method); a prepaid package's authorization is the real Stripe payment
  -- itself, so this stays null there.
  payment_authorization_accepted_at timestamptz,
  constraint booking_orders_payment_authorization_required_for_normal check (
    booking_type = 'prepaid_package' or payment_authorization_accepted_at is not null
  ),

  -- Immutable booking pricing snapshot for the ONE option the customer
  -- actually chose (never all 7 precomputed options) — frozen at INSERT
  -- time via the trigger below. Parallel concept to
  -- quote_requests.pricing_snapshot, but its own record: the original
  -- quote's snapshot is never overwritten by a booking decision.
  pricing_version text not null,
  pricing_snapshot jsonb not null,

  calculated_total numeric(10, 2) not null,
  display_range_lower numeric(10, 2),
  display_range_upper numeric(10, 2),
  prepaid_package_total numeric(10, 2),
  effective_price_per_visit numeric(10, 2),
  has_starting_at_pricing boolean not null default false,
  manual_review_reasons text[] not null default '{}',

  -- Fixed/starting-at add-ons carried from the quote's post-estimate
  -- customization (normal bookings only in practice — a prepaid package
  -- purchase never collects add-ons at purchase time; visit-specific
  -- extras are assigned later, when individual visits are scheduled).
  selected_add_on_ids text[] not null default '{}',

  -- Service-address snapshot, same rationale as quote_requests/
  -- service_visits: independently understandable without a join, and
  -- immune to the customer moving before this booking is fulfilled.
  service_address_line1 text,
  service_address_line2 text,
  service_city text,
  service_state text,
  service_address_identity text,

  -- Normal booking only; both stay null for a prepaid package (no
  -- cleaning date is collected before payment — dates are scheduled
  -- later, once individual package visits exist).
  requested_date date,
  requested_time_window text
    check (requested_time_window is null or requested_time_window in ('morning', 'afternoon', 'evening')),
  constraint booking_orders_prepaid_has_no_schedule_fields check (
    booking_type = 'normal'
    or (requested_date is null and requested_time_window is null)
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.booking_orders is
  'One row per customer booking decision from a completed quote. Source of truth (with payment_attempts and prepaid_packages) for this milestone; never writes back to quote_requests. No service_visits row is created here or at payment time — those are created later, when a visit is actually scheduled (a future milestone).';

comment on column public.booking_orders.client_request_id is
  'Client-generated (crypto.randomUUID()) once per visit to the booking page, resent on every retry of the same submission. The durable half of booking-creation idempotency — see table comment and repository insert logic.';

-- Booking pricing snapshot immutability — same shape/intent as
-- protect_quote_pricing_snapshot() in
-- 20260817200100_extend_quote_requests_for_instant_quotes.sql. Set at
-- INSERT here (never null-then-later-set), so this effectively locks the
-- pricing fields immediately; status/workflow fields remain updatable.
create or replace function public.protect_booking_order_pricing_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.pricing_version is distinct from old.pricing_version
    or new.calculated_total is distinct from old.calculated_total
    or new.display_range_lower is distinct from old.display_range_lower
    or new.display_range_upper is distinct from old.display_range_upper
    or new.prepaid_package_total is distinct from old.prepaid_package_total
    or new.effective_price_per_visit is distinct from old.effective_price_per_visit
    or new.has_starting_at_pricing is distinct from old.has_starting_at_pricing
    or new.manual_review_reasons is distinct from old.manual_review_reasons
  then
    raise exception
      'booking_orders pricing fields are immutable once set (id=%). Create a new booking order instead of modifying a historical one.',
      old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_booking_order_pricing_snapshot() is
  'BEFORE UPDATE guard: rejects any change to pricing_snapshot or the denormalized pricing scalar columns. Workflow fields (status, updated_at, etc.) remain freely updatable.';

create trigger booking_orders_protect_pricing_snapshot
before update on public.booking_orders
for each row execute function public.protect_booking_order_pricing_snapshot();

create trigger booking_orders_set_updated_at
before update on public.booking_orders
for each row execute function public.set_updated_at();

create index booking_orders_quote_request_id_idx
  on public.booking_orders (quote_request_id);
create index booking_orders_customer_id_idx
  on public.booking_orders (customer_id);
create index booking_orders_status_idx
  on public.booking_orders (status);

alter table public.booking_orders enable row level security;

revoke all privileges
on table public.booking_orders
from anon, authenticated;

grant select, insert, update
on table public.booking_orders
to service_role;
-- No delete grant — a cancelled booking is a status, not a deletion.
