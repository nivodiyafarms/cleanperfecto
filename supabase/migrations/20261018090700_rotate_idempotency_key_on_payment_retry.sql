-- ============================================================================
-- Migration: rotate idempotency_key inside begin_visit_payment_retry().
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Bug found during real Preview + Stripe test-mode verification of
-- "Revise & Resend Final Total" / card retry (20261018090400 group): with
-- the original definition, begin_visit_payment_retry nulled
-- stripe_payment_intent_id but left idempotency_key UNCHANGED. Stripe's
-- idempotency layer replays the ORIGINAL response for any repeat
-- create-PaymentIntent call using the same key (within its retention
-- window) regardless of what later happened to that PaymentIntent — so
-- createVisitPaymentIntent's retry branch, which calls
-- gateway.createPaymentIntent with payment.idempotencyKey immediately
-- after the claim, got back the SAME (already-canceled) PaymentIntent
-- object instead of a genuinely new one. Verified directly against Stripe
-- test mode: cancelling the original intent and retrying produced a
-- "ready" outcome with an identical client_secret/PaymentIntent id to the
-- dead one.
--
-- start_visit_pricing_revision already rotates idempotency_key for exactly
-- this reason (see its own migration, 20261018090600) — this migration
-- gives begin_visit_payment_retry the same treatment. Scoped narrowly to
-- idempotency_key only: that column is NOT one of the frozen financial-fact
-- columns protect_service_visit_payments_financial_facts() guards (see
-- 20260828100300_create_service_visit_payments.sql), so no trigger escape
-- is needed for this change — it was already freely updatable regardless
-- of tip_confirmed_at.
--
-- Dependencies: requires begin_visit_payment_retry
-- (20261018090400_create_claim_visit_payment_attempt_and_retry_functions.sql)
-- to already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement — a single function
-- replacement (CREATE OR REPLACE, same signature, same return type).
-- ============================================================================

create or replace function public.begin_visit_payment_retry(
  p_service_visit_id uuid,
  p_expected_old_payment_intent_id text
)
returns public.service_visit_payments
language plpgsql
set search_path = public
as $$
declare
  v_payment service_visit_payments;
begin
  perform pg_advisory_xact_lock(hashtextextended('visit_payment_claim:' || p_service_visit_id::text, 0));

  if exists (
    select 1 from service_visit_pricing
    where service_visit_id = p_service_visit_id and price_status = 'revision_in_progress'
  ) then
    raise exception 'revision_in_progress';
  end if;

  set local app.allow_payment_retry_intent_clear = 'true';

  update service_visit_payments
  set status = 'processing',
      stripe_payment_intent_id = null,
      -- Rotated so the replacement gateway.createPaymentIntent call (the
      -- caller's very next step) cannot collide with Stripe's own
      -- idempotency cache for the dead intent's original create call. The
      -- safe-retry branch in createVisitPaymentIntent (financial facts
      -- froze but the create call itself failed before persisting an
      -- intent id) correctly reuses THIS freshly-rotated value on its own
      -- subsequent attempts, exactly as it already reused the original.
      idempotency_key = 'visit-payment:' || p_service_visit_id::text || ':retry:' || gen_random_uuid()::text
  where service_visit_id = p_service_visit_id
    and status in ('processing', 'payment_failed')
    and stripe_payment_intent_id is not distinct from p_expected_old_payment_intent_id
  returning * into v_payment;

  if v_payment.id is null then
    raise exception 'not_eligible';
  end if;

  return v_payment;
end;
$$;

comment on function public.begin_visit_payment_retry(uuid, text) is
  'Durable in-flight claim for REPLACING a dead PaymentIntent: atomically nulls stripe_payment_intent_id (via the dedicated app.allow_payment_retry_intent_clear trigger escape) AND rotates idempotency_key to a fresh value (so the replacement create-PaymentIntent call cannot hit Stripe''s idempotency cache for the dead intent''s original response), while leaving every other financial-fact column and the row untouched otherwise. Gated on price_status != revision_in_progress and a compare-and-swap on the exact expected dead intent id. Accepts local status processing OR payment_failed (the canceling webhook may not have landed yet). Raises ''revision_in_progress''/''not_eligible'' when blocked. Sole caller: createVisitPaymentIntent (src/lib/payments/create-visit-payment-intent.ts), which records the replacement intent''s id in a separate follow-up write after Stripe responds.';
