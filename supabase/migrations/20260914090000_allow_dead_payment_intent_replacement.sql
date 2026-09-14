-- ============================================================================
-- Migration: allow stripe_payment_intent_id replacement on a dead attempt
-- Live-payment hardening milestone — Phase D (PaymentIntent retry lifecycle).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Problem: protect_service_visit_payments_financial_facts() currently makes
-- stripe_payment_intent_id immutable unconditionally once set — see
-- 20260828100300_create_service_visit_payments.sql. This means an
-- already-frozen row whose PaymentIntent Stripe reports as permanently
-- 'canceled' (see decidePaymentIntentRetry in
-- src/lib/payments/payment-intent-retry-decision.ts) has no way to ever be
-- charged again: a fresh PaymentIntent cannot be attached to the same row.
-- create-visit-payment-intent.ts currently detects this and throws
-- DeadPaymentIntentError rather than silently returning a dead client_secret
-- or creating an ambiguous duplicate-charge risk, but doing anything other
-- than "fail and require manual intervention" needs this relaxation.
--
-- Fix: allow stripe_payment_intent_id to be replaced exactly when the
-- row's CURRENT status is 'payment_failed' — the one status a canceled
-- Stripe PaymentIntent is mapped to (see process-stripe-webhook-event.ts's
-- payment_intent.canceled handling), and the only status this migration
-- considers "definitively dead, safe to retry with a new intent." Every
-- other status (created, processing, requires_action, paid,
-- partially_refunded, refunded, no_payment_due) remains exactly as
-- immutable as before — this is a narrow, targeted relaxation, not a
-- general loosening of the guard.
--
-- Note: this migration only updates the trigger function; it intentionally
-- does NOT add a new application-layer repository method to perform the
-- replacement write. That (a `replaceDeadServiceVisitPaymentIntent`-style
-- method on SchedulingRepository, wired into create-visit-payment-intent.ts
-- in place of throwing DeadPaymentIntentError) is deliberately left for a
-- follow-up pass once this schema change itself has been reviewed and
-- applied to operational-beta-preview and rehearsed there.
-- ============================================================================

create or replace function public.protect_service_visit_payments_financial_facts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tip_confirmed_at is not null then
    if new.service_visit_id is distinct from old.service_visit_id
      or new.service_visit_pricing_id is distinct from old.service_visit_pricing_id
      or new.approved_amount is distinct from old.approved_amount
      or new.tip_basis_amount is distinct from old.tip_basis_amount
      or new.tip_selection_type is distinct from old.tip_selection_type
      or new.tip_percentage is distinct from old.tip_percentage
      or new.tip_amount is distinct from old.tip_amount
      or new.tax_amount is distinct from old.tax_amount
      or new.total_amount is distinct from old.total_amount
      or new.tip_confirmed_at is distinct from old.tip_confirmed_at
    then
      raise exception
        'service_visit_payments financial facts are immutable once tip_confirmed_at is set (id=%)', old.id;
    end if;
  end if;

  if old.stripe_payment_intent_id is not null
    and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
    and old.status is distinct from 'payment_failed'
  then
    raise exception
      'service_visit_payments.stripe_payment_intent_id can only be replaced when the prior attempt is dead (status=payment_failed); current status=% (id=%)', old.status, old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_service_visit_payments_financial_facts() is
  'BEFORE UPDATE guard: once tip_confirmed_at is set, rejects any change to the customer-facing financial fact columns (never Stripe-tax bookkeeping, status, or refund fields, which must remain mutable for reconciliation). stripe_payment_intent_id is separately frozen once set, EXCEPT it may be replaced exactly when the row''s current status is payment_failed (a definitively dead attempt, including a canceled PaymentIntent per payment_intent.canceled handling) — narrow, targeted relaxation added for the PaymentIntent retry lifecycle (Live-payment hardening Phase D).';
