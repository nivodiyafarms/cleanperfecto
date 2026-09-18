-- ============================================================================
-- Migration: prepaid_packages tax accounting columns
-- Live-payment hardening milestone — Phase H.1 (prepaid package tax fix).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Root cause (found via real Stripe sandbox testing): a prepaid package
-- Checkout Session has automatic_tax enabled (see
-- create-prepaid-package-checkout.ts / stripe/checkout-sessions.ts), so the
-- customer is actually charged package_total_paid + Stripe Tax. The webhook
-- activation path (finalizeVerifiedPayment in
-- process-stripe-webhook-event.ts) has always populated package_total_paid
-- from the pricing engine's pre-tax prepaidPackageTotal only — the tax
-- portion Stripe actually collected was never read from the Checkout
-- Session or persisted anywhere. package_total_paid's own column comment
-- claimed it was "inclusive of whatever Stripe Tax collected," which was
-- never true; that comment is corrected below rather than the column's
-- actual (correct, and refund-math-critical) meaning.
--
-- package_total_paid is NOT redefined or repopulated by this migration —
-- refund-prepaid-package.ts's finalized policy (refundable principal =
-- package_total_paid * remaining/purchased) already correctly treats it as
-- the pre-tax principal, and that arithmetic is untouched. This migration
-- only adds the columns needed to also durably record what was actually
-- charged, so invoices/receipts can show a truthful breakdown and future
-- reconciliation has an immutable Stripe-sourced fact to check against.
-- ============================================================================

alter table public.prepaid_packages
  add column tax_amount numeric(10, 2),
  add column total_amount_paid numeric(10, 2),
  add column stripe_tax_transaction_id text;

comment on column public.prepaid_packages.package_total_paid is
  'The pre-tax package principal actually charged (the discounted Checkout line-item subtotal), server-derived from the pricing engine at purchase time — never client-supplied, never repriced later. This is the ONLY amount refund-prepaid-package.ts''s finalized policy multiplies by (remaining_visit_count / purchased_visit_count); Stripe Tax is tracked separately in tax_amount and must never be included here or double-counted in refund math.';

comment on column public.prepaid_packages.tax_amount is
  'The real Stripe Tax amount collected on this package purchase (from the settled Checkout Session''s total_details.amount_tax), persisted once at activation — an immutable historical fact, never recomputed from current tax rates. Null on packages purchased before this column existed, or if TAX_MODE was disabled at purchase time; 0 is a genuine "$0 tax charged" fact, distinct from null ("never recorded").';

comment on column public.prepaid_packages.total_amount_paid is
  'The exact total the customer''s payment method was charged (Checkout Session amount_total = package_total_paid + tax_amount), persisted once at activation directly from Stripe''s own settled amount — never derived by addition in application code, so this stays the authoritative cross-check even if package_total_paid + tax_amount ever disagreed by a rounding cent. Null on packages purchased before this column existed.';

comment on column public.prepaid_packages.stripe_tax_transaction_id is
  'The committed Stripe Tax transaction id for this purchase (via Stripe''s Tax Association for the settled PaymentIntent), persisted once at activation so a later cancellation refund''s tax reversal (see refund-prepaid-package.ts) has a durable local reference in addition to the live Stripe lookup it already performs. Null when no Stripe Tax transaction was ever committed (e.g. TAX_MODE disabled at purchase time) or for packages purchased before this column existed.';
