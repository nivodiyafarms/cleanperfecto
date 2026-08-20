-- ============================================================================
-- Migration: add stripe_customer_id to customers
-- Booking + Payment Phase 1 (owner-approved).
--
-- One Stripe Customer object is created (and reused on future bookings) per
-- CleanPerfecto customer the first time they reach Stripe Checkout, so a
-- saved payment method / tax address can be associated with the right
-- person across multiple bookings.
-- ============================================================================

alter table public.customers
  add column stripe_customer_id text;

comment on column public.customers.stripe_customer_id is
  'Stripe Customer id (cus_...), set the first time this customer reaches Stripe Checkout (booking or prepaid package purchase). Server-generated only — never client-supplied. Unlike email_normalized/phone_normalized above, this IS enforced unique: it is a direct 1:1 mapping to a specific external Stripe object, not a fuzzy identity-matching key.';

create unique index customers_stripe_customer_id_idx
  on public.customers (stripe_customer_id) where stripe_customer_id is not null;
