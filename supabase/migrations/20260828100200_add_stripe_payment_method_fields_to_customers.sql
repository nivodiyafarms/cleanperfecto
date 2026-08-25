-- ============================================================================
-- Migration: add saved-payment-method display fields to customers
-- Pay-Per-Cleaning Charge & Payment Completion V1 milestone.
--
-- Persists the ONE thing the existing SetupIntent/setup-mode Checkout flow
-- never captured: which PaymentMethod actually resulted from a succeeded
-- SetupIntent. Populated exclusively by server-side webhook code reading a
-- verified SetupIntent object (see handleSetupSessionCompleted) — never by
-- trusting a client-supplied PaymentMethod id. This is the authoritative
-- source used to resolve which saved card to charge for a post-completion
-- Pay Per Cleaning PaymentIntent.
--
-- brand/last4/exp_month/exp_year are PCI-safe display fields only (Stripe's
-- own card object already exposes these without exposing the PAN/CVC) —
-- cached here purely so /my/payments and Admin can show "Visa •••• 4242"
-- without an extra Stripe round-trip on every page render. Overwritten (not
-- appended) on every successful setup, including the Update Payment Method
-- flow — V1 has exactly one "current" saved payment method per customer,
-- no multi-card management.
-- ============================================================================

alter table public.customers
  add column stripe_default_payment_method_id text,
  add column stripe_payment_method_brand text,
  add column stripe_payment_method_last4 text,
  add column stripe_payment_method_exp_month smallint,
  add column stripe_payment_method_exp_year smallint;

comment on column public.customers.stripe_default_payment_method_id is
  'Stripe PaymentMethod id (pm_...) resolved server-side from a succeeded SetupIntent (initial booking setup or a later Update Payment Method setup session) — never client-supplied. The authoritative payment method used to create a post-completion Pay Per Cleaning PaymentIntent. Overwritten, not appended, on every successful setup.';

comment on column public.customers.stripe_payment_method_brand is
  'Display-only card brand (e.g. "visa"), cached from the PaymentMethod object at the same time stripe_default_payment_method_id is set. Never the card number.';

comment on column public.customers.stripe_payment_method_last4 is
  'Display-only last 4 digits, cached alongside stripe_payment_method_brand. Never the full card number.';
