-- ============================================================================
-- Migration: claim_visit_payment_attempt + begin_visit_payment_retry —
-- atomic, advisory-locked claims coordinating card-payment creation and
-- retry with the "Revise & Resend Final Total" revision window.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Both acquire pg_advisory_xact_lock(hashtextextended('visit_payment_claim:'
-- || service_visit_id, 0)) — namespaced (not the bare md5(id) idiom used by
-- claim_payment_link_resend/claim_agreed_quote_invitation_send, which would
-- collide with THIS feature's own unrelated use of the same visit id as a
-- lock key for a different purpose) as the FIRST statement, same
-- hashtextextended-with-purpose-prefix idiom already used by
-- issue_visit_payment_documents (20261005120000_harden_webhook_claim_and_document_idempotency.sql)
-- — so this family of operations (these two, plus
-- record_external_visit_payment_with_audit and start_visit_pricing_revision,
-- widened/created in sibling migrations) fully serializes against each
-- other for the same visit, while never blocking an unrelated visit or an
-- unrelated lock purpose on the same visit id.
--
-- claim_visit_payment_attempt — the durable in-flight claim for a FRESH
-- card-payment attempt: committed BEFORE any Stripe API call, so a
-- concurrent revision attempt sees this row is claimed even before a
-- PaymentIntent exists (closing the gap a post-hoc intent-id comparison
-- alone cannot). Replaces the application's prior unconditional
-- freezeServiceVisitPaymentForStripeCard write — same columns, now also
-- gated on price_status != 'revision_in_progress' and atomically
-- transitioning status 'created' -> 'processing' in the same statement.
--
-- begin_visit_payment_retry — the sibling claim for REPLACING a dead
-- PaymentIntent (Stripe status 'canceled', which reconciles to local status
-- 'payment_failed' — see payment-status-transitions.ts). Accepts local
-- status 'processing' OR 'payment_failed' as the pre-retry state: the
-- canceling webhook may not have landed yet when the customer retries, and
-- createVisitPaymentIntent's existing retry decision already treats a
-- freshly-retrieved Stripe status as ground truth over the local column —
-- this RPC must work correctly regardless of which local status it finds.
-- Nulls stripe_payment_intent_id (never sets a new one directly — the
-- caller records the replacement intent's id in a separate follow-up write
-- after Stripe responds, via the existing setServiceVisitPaymentIntent,
-- exactly like the original claim path) under the dedicated
-- app.allow_payment_retry_intent_clear escape added in the sibling trigger
-- migration — a flag deliberately separate from
-- app.allow_payment_revision_reset so this path can never, even in
-- principle, touch the frozen financial-fact columns that flag also guards.
-- The row lands at status='processing' with stripe_payment_intent_id=null —
-- structurally identical to claim_visit_payment_attempt's own pre-intent-id
-- window, so start_visit_pricing_revision's existing
-- "processing+null-intent -> always refuse" rule already covers this
-- in-flight window too, with no new rule needed on the revision side.
--
-- Both raise a plain 'revision_in_progress' or 'not_eligible' exception
-- when blocked — same convention as every other business-rule rejection in
-- this schema (the calling application code matches on error.message).
--
-- Dependencies: requires service_visit_payments, service_visit_pricing
-- (widened by 20261018090000/20261018090100/20261018090200 in this same
-- migration group) to already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement — two new function
-- definitions only.
-- ============================================================================

create or replace function public.claim_visit_payment_attempt(
  p_service_visit_id uuid,
  p_stripe_customer_id text,
  p_stripe_payment_method_id text,
  p_card_brand text,
  p_card_last4 text
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

  update service_visit_payments
  set payment_method_type = 'stripe_card',
      stripe_customer_id = p_stripe_customer_id,
      stripe_payment_method_id = p_stripe_payment_method_id,
      card_brand = p_card_brand,
      card_last4 = p_card_last4,
      tip_confirmed_at = now(),
      status = 'processing'
  where service_visit_id = p_service_visit_id
    and status = 'created'
    and tip_confirmed_at is null
  returning * into v_payment;

  if v_payment.id is null then
    raise exception 'not_eligible';
  end if;

  return v_payment;
end;
$$;

comment on function public.claim_visit_payment_attempt(uuid, text, text, text, text) is
  'Durable in-flight claim for a fresh card-payment attempt: atomically freezes the row (same fields as the former freezeServiceVisitPaymentForStripeCard) and transitions status created -> processing, BEFORE any Stripe API call, gated on price_status != revision_in_progress. Raises ''revision_in_progress''/''not_eligible'' when blocked. Sole caller: createVisitPaymentIntent (src/lib/payments/create-visit-payment-intent.ts).';

revoke all on function public.claim_visit_payment_attempt(uuid, text, text, text, text)
from public, anon, authenticated;

grant execute on function public.claim_visit_payment_attempt(uuid, text, text, text, text)
to service_role;

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
      stripe_payment_intent_id = null
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
  'Durable in-flight claim for REPLACING a dead PaymentIntent: atomically nulls stripe_payment_intent_id (via the dedicated app.allow_payment_retry_intent_clear trigger escape) while leaving every financial-fact column and the row untouched otherwise, gated on price_status != revision_in_progress and a compare-and-swap on the exact expected dead intent id. Accepts local status processing OR payment_failed (the canceling webhook may not have landed yet). Raises ''revision_in_progress''/''not_eligible'' when blocked. Sole caller: createVisitPaymentIntent (src/lib/payments/create-visit-payment-intent.ts), which records the replacement intent''s id in a separate follow-up write after Stripe responds.';

revoke all on function public.begin_visit_payment_retry(uuid, text)
from public, anon, authenticated;

grant execute on function public.begin_visit_payment_retry(uuid, text)
to service_role;
