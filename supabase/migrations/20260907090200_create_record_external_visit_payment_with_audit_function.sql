-- ============================================================================
-- Migration: record_external_visit_payment_with_audit() atomic RPC
-- Phase 2 — Final Money-Path Integrity Review.
--
-- AUTHORED ONLY — DO NOT APPLY. Rehearsed and reviewed in Phase 3.
--
-- Fixes a real gap found during review: the application previously settled
-- an external (zelle/cash) payment via one write (recordExternalServiceVisitPayment,
-- itself two sequential UPDATEs — see below), then a SEPARATE write to
-- service_visit_pricing.payment_status, then a THIRD, independent write to
-- financial_audit_log from the admin-action layer — three unrelated
-- round-trips, not one transaction. A network hiccup or RLS problem between
-- the payment settling and the audit insert would leave a genuinely-paid
-- visit with NO actor audit row at all, which fails Phase 2's own stated
-- auditability requirement ("a successful external-receipt recording must
-- have a traceable actor").
--
-- This function performs the full settlement (both of
-- recordExternalServiceVisitPayment's existing sub-steps — the main
-- settlement update, and the conditional tip_confirmed_at freeze when a
-- tip was selected but never Stripe-confirmed pre-freeze), the
-- service_visit_pricing.payment_status transition, AND the
-- financial_audit_log insert, all inside one PL/pgSQL function body — a
-- single Postgres transaction. If any step raises, EVERY effect of this
-- call rolls back; nothing is left half-committed. Replaces
-- recordExternalServiceVisitPayment + the caller's separate
-- updateServiceVisitPricingPaymentStatus + financial_audit_log insert as
-- the one path for this specific flow — see
-- src/lib/payments/record-external-payment.ts.
--
-- The Stripe Tax transaction commit (this table's tax_transaction_status)
-- remains a SEPARATE, deliberately best-effort step after this function
-- returns — unchanged, pre-existing, approved architecture (see the
-- table's own migration comment on why: Stripe availability shouldn't be
-- able to block or reverse a payment fact that has already genuinely
-- settled). This function only ever sets tax_transaction_status='pending'
-- (its correct initial value), never 'committed'/'failed'.
--
-- Dependencies: requires service_visit_payments
-- (20260828100300_create_service_visit_payments.sql), service_visit_pricing
-- (20260824100400_create_service_visit_pricing.sql /
-- 20260828100000_widen_service_visit_pricing_payment_status_for_payments_v1.sql),
-- and financial_audit_log (20260907090100_create_financial_audit_log.sql)
-- to already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement, no cron/side effect —
-- a single new function definition. Mirrors this schema's existing atomic-
-- RPC convention (set_service_visit_schedule, complete_service_visit,
-- claim_due_service_visit_notifications) rather than inventing a new
-- pattern.
-- ============================================================================

create or replace function public.record_external_visit_payment_with_audit(
  p_service_visit_payment_id uuid,
  p_payment_method_type text,
  p_external_payment_reference text,
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.service_visit_payments
language plpgsql
set search_path = public
as $$
declare
  v_payment service_visit_payments;
begin
  if p_payment_method_type not in ('zelle', 'cash') then
    raise exception 'record_external_visit_payment_with_audit: payment_method_type must be zelle or cash, got %', p_payment_method_type;
  end if;

  update service_visit_payments
  set payment_method_type = p_payment_method_type,
      external_payment_reference = p_external_payment_reference,
      status = 'paid',
      paid_at = now(),
      tax_transaction_status = 'pending'
  where id = p_service_visit_payment_id
    and status = 'created'
  returning * into v_payment;

  if v_payment.id is null then
    raise exception 'service_visit_payments % is not eligible for external settlement (must be status=created)', p_service_visit_payment_id;
  end if;

  -- Same conditional tip-freeze sub-step recordExternalServiceVisitPayment
  -- already performed as a second UPDATE (a tip selected pre-freeze but
  -- never Stripe-confirmed) — now inside the same transaction as
  -- everything else in this function, closing a pre-existing minor
  -- non-atomicity between these two sub-updates as a side effect.
  if v_payment.tip_confirmed_at is null then
    update service_visit_payments
    set tip_confirmed_at = now()
    where id = p_service_visit_payment_id
      and tip_confirmed_at is null
    returning * into v_payment;
  end if;

  update service_visit_pricing
  set payment_status = 'paid'
  where service_visit_id = v_payment.service_visit_id;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'external_payment_recorded',
    'service_visit_payment', p_service_visit_payment_id, v_payment.service_visit_id,
    p_external_payment_reference,
    jsonb_build_object(
      'paymentMethodType', p_payment_method_type,
      'totalAmount', v_payment.total_amount
    )
  );

  return v_payment;
end;
$$;

comment on function public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text) is
  'Atomically settles an external (zelle/cash) service_visit_payments row AND records the required financial_audit_log actor-attribution row in one transaction — either both commit or neither does. See src/lib/payments/record-external-payment.ts, the sole caller.';

revoke all on function public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text)
from public, anon, authenticated;

grant execute on function public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text)
to service_role;
