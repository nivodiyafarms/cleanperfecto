-- ============================================================================
-- Migration: start_visit_pricing_revision() — the atomic entry point for
-- "Revise & Resend Final Total".
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Owner-only at the application layer (financial_correction capability,
-- asserted by startVisitPricingRevisionAction before this is ever reached —
-- this RPC trusts p_actor_admin_user_id/role exactly as every other
-- *_with_audit RPC in this schema trusts its own actor parameters).
--
-- Acquires the SAME advisory lock as claim_visit_payment_attempt/
-- begin_visit_payment_retry/record_external_visit_payment_with_audit
-- (hashtextextended('visit_payment_claim:' || service_visit_id, 0)) first,
-- so this fully serializes against every other operation that can claim or
-- settle this visit's payment row.
--
-- Idempotent re-entry: if the row is already mid-revision, this is a
-- genuine no-op (returns the current pricing row unchanged, no audit log
-- entry, no event, no payment reset) — a double-click or retried request
-- must never double-increment revision_number or re-snapshot an
-- already-reset payment row.
--
-- The caller (startVisitPricingRevision, src/lib/scheduling/start-visit-
-- pricing-revision.ts) has ALREADY, outside this transaction, freshly
-- retrieved the live Stripe PaymentIntent (if any) and either confirmed it
-- cancelled or cancelled it itself — p_expected_payment_intent_id is that
-- verified id (or null, if none existed). This RPC's own compare-and-swap
-- is the defense-in-depth layer for the narrow remaining gap between that
-- verification and this transaction acquiring the lock — never a
-- replacement for the caller's own fresh Stripe check, and it does NOT
-- re-verify anything with Stripe itself (Postgres cannot call the Stripe
-- API).
--
-- The 'processing' + null-stripe_payment_intent_id case (an unresolved
-- in-flight claim — either claim_visit_payment_attempt's own pre-intent-id
-- window, or begin_visit_payment_retry's structurally identical one) is
-- ALWAYS refused, with no CAS evaluated at all — there is no evidence yet
-- to compare against. Every other case (no payment row; status='created';
-- or 'processing'/'payment_failed' WITH a recorded intent id) is gated
-- solely by the CAS on that exact intent id — this is what makes a
-- declined/stuck/cancelled card attempt genuinely revisable rather than
-- permanently stuck behind a non-'created' status.
--
-- Preserves the full prior payment-attempt history as a complete,
-- queryable snapshot in financial_audit_log.metadata (every frozen field,
-- not a summary) BEFORE resetting the row, and rotates idempotency_key to
-- a fresh, revision-scoped value (the column is otherwise reused verbatim
-- as the Stripe idempotency key for every retry — without rotating it, a
-- post-revision createPaymentIntent call would reuse the ORIGINAL key and
-- Stripe would hand back its cached original-amount response instead of
-- creating a genuinely new intent).
--
-- Dependencies: requires service_visit_pricing/service_visit_payments
-- (widened by 20261018090000/20261018090100/20261018090200), the
-- financial_audit_log/service_visit_events CHECK widening
-- (20261018090300), and the shared lock family (20261018090400) to already
-- be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement — one new function
-- definition.
-- ============================================================================

create or replace function public.start_visit_pricing_revision(
  p_service_visit_id uuid,
  p_actor_admin_user_id uuid,
  p_actor_role text,
  p_reason text,
  p_expected_payment_intent_id text
)
returns public.service_visit_pricing
language plpgsql
set search_path = public
as $$
declare
  v_visit_status text;
  v_pricing service_visit_pricing;
  v_payment service_visit_payments;
  v_new_revision_number integer;
  v_old_payment_snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('visit_payment_claim:' || p_service_visit_id::text, 0));

  select status into v_visit_status from service_visits where id = p_service_visit_id;
  if v_visit_status is null then
    raise exception 'service_visit % not found', p_service_visit_id;
  end if;
  if v_visit_status != 'completed' then
    raise exception 'not_completed';
  end if;

  select * into v_pricing from service_visit_pricing where service_visit_id = p_service_visit_id;
  if v_pricing.id is null then
    raise exception 'pricing_not_confirmed';
  end if;

  -- Idempotent re-entry: already mid-revision — a genuine no-op, not an
  -- error. Never re-increments revision_number or re-snapshots/re-resets
  -- an already-reset payment row.
  if v_pricing.price_status = 'revision_in_progress' then
    return v_pricing;
  end if;

  if v_pricing.price_status != 'confirmed' then
    raise exception 'pricing_not_confirmed';
  end if;

  select * into v_payment from service_visit_payments where service_visit_id = p_service_visit_id;

  if v_payment.id is not null then
    if v_payment.status in ('paid', 'partially_refunded', 'refunded') then
      raise exception 'already_paid';
    end if;
    if v_payment.status = 'processing' and v_payment.stripe_payment_intent_id is null then
      raise exception 'payment_attempt_in_progress';
    end if;
    if v_payment.stripe_payment_intent_id is not distinct from p_expected_payment_intent_id then
      -- matches — proceed.
      null;
    else
      raise exception 'concurrent_modification';
    end if;
  end if;

  v_new_revision_number := v_pricing.revision_number + 1;

  set local app.allow_payment_revision_reset = 'true';

  update service_visit_pricing
  set price_status = 'revision_in_progress',
      revision_number = v_new_revision_number
  where service_visit_id = p_service_visit_id
    and price_status = 'confirmed'
  returning * into v_pricing;

  if v_pricing.id is null then
    raise exception 'concurrent_modification';
  end if;

  if v_payment.id is not null then
    v_old_payment_snapshot := jsonb_build_object(
      'id', v_payment.id,
      'approvedAmount', v_payment.approved_amount,
      'tipBasisAmount', v_payment.tip_basis_amount,
      'tipSelectionType', v_payment.tip_selection_type,
      'tipPercentage', v_payment.tip_percentage,
      'tipAmount', v_payment.tip_amount,
      'taxAmount', v_payment.tax_amount,
      'totalAmount', v_payment.total_amount,
      'tipSelectedAt', v_payment.tip_selected_at,
      'tipConfirmedAt', v_payment.tip_confirmed_at,
      'paymentMethodType', v_payment.payment_method_type,
      'stripeCustomerId', v_payment.stripe_customer_id,
      'stripePaymentMethodId', v_payment.stripe_payment_method_id,
      'cardBrand', v_payment.card_brand,
      'cardLast4', v_payment.card_last4,
      'stripePaymentIntentId', v_payment.stripe_payment_intent_id,
      'stripeTaxCalculationId', v_payment.stripe_tax_calculation_id,
      'taxTransactionStatus', v_payment.tax_transaction_status,
      'stripeTaxTransactionId', v_payment.stripe_tax_transaction_id,
      'externalPaymentReference', v_payment.external_payment_reference,
      'status', v_payment.status,
      'idempotencyKey', v_payment.idempotency_key,
      'failureCode', v_payment.failure_code,
      'failureMessage', v_payment.failure_message,
      'refundedAmount', v_payment.refunded_amount,
      'refundedAt', v_payment.refunded_at,
      'paidAt', v_payment.paid_at
    );

    update service_visit_payments
    set approved_amount = v_pricing.amount_due_from_customer,
        tip_basis_amount = null,
        tip_selection_type = null,
        tip_percentage = null,
        tip_amount = null,
        tax_amount = null,
        total_amount = null,
        tip_selected_at = null,
        tip_confirmed_at = null,
        tax_location_snapshot = null,
        payment_method_type = null,
        stripe_customer_id = null,
        stripe_payment_method_id = null,
        card_brand = null,
        card_last4 = null,
        stripe_payment_intent_id = null,
        stripe_tax_calculation_id = null,
        tax_calculation_expires_at = null,
        tax_transaction_status = 'not_applicable',
        stripe_tax_transaction_id = null,
        tax_transaction_failure_code = null,
        tax_transaction_failure_message = null,
        tax_transaction_last_attempt_at = null,
        external_payment_reference = null,
        status = 'created',
        idempotency_key = 'visit-payment:' || p_service_visit_id::text || ':v' || v_new_revision_number::text,
        failure_code = null,
        failure_message = null,
        refunded_amount = 0,
        refunded_at = null,
        paid_at = null
    where service_visit_id = p_service_visit_id
      and id = v_payment.id
      and stripe_payment_intent_id is not distinct from p_expected_payment_intent_id
      and status not in ('paid', 'partially_refunded', 'refunded')
      and not (status = 'processing' and stripe_payment_intent_id is null);

    if not found then
      raise exception 'concurrent_modification';
    end if;
  end if;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'final_total_revision_started',
    'service_visit_pricing', v_pricing.id, p_service_visit_id,
    p_reason,
    jsonb_build_object(
      'revisionNumber', v_new_revision_number,
      'priorPayment', v_old_payment_snapshot
    )
  );

  insert into service_visit_events (
    service_visit_id, event_type, actor, previous_state, new_state, notes
  ) values (
    p_service_visit_id, 'visit_pricing_revision_started', 'admin:' || p_actor_admin_user_id::text,
    jsonb_build_object('priceStatus', 'confirmed'),
    jsonb_build_object('priceStatus', 'revision_in_progress', 'revisionNumber', v_new_revision_number),
    p_reason
  );

  return v_pricing;
end;
$$;

comment on function public.start_visit_pricing_revision(uuid, uuid, text, text, text) is
  'Atomic entry point for Revise & Resend Final Total: reopens a completed visit''s pricing (price_status -> revision_in_progress, revision_number incremented) and resets its payment row (snapshotting the full prior attempt into financial_audit_log.metadata first), all under the shared visit_payment_claim advisory lock. Refuses while an unresolved in-flight claim exists (processing + null intent id, no evidence); otherwise gated by a compare-and-swap on the caller''s already-Stripe-verified expected intent id. Idempotent re-entry (already revision_in_progress) is a no-op. Owner-only authorization is enforced by the caller. See src/lib/scheduling/start-visit-pricing-revision.ts, the sole caller.';

revoke all on function public.start_visit_pricing_revision(uuid, uuid, text, text, text)
from public, anon, authenticated;

grant execute on function public.start_visit_pricing_revision(uuid, uuid, text, text, text)
to service_role;
