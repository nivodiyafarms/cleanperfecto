-- ============================================================================
-- Migration: refund_visit_payment_with_audit() atomic RPC
-- Live-payment hardening milestone — Phase E (refund architecture).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Mirrors the existing atomic-RPC convention (record_external_visit_payment_with_audit,
-- waive_service_fee_assessment_with_audit): the financial state transition
-- AND the required financial_audit_log actor-attribution row commit in one
-- transaction — either both succeed or neither does.
--
-- Terminal-state protection (reusing Phase A's payment-status-transitions.ts
-- rules at the DB layer, same as those webhook-reconciliation paths):
-- refundable only from status IN ('paid', 'partially_refunded') — never
-- from created/processing/requires_action/payment_failed/no_payment_due/
-- refunded. `for update` row-locks the row for the duration of the
-- transaction so two concurrent refund attempts against the same row can
-- never both read a stale refunded_amount and together over-refund.
--
-- No-over-refund: new total refunded (existing refunded_amount + this
-- refund) can never exceed total_amount — enforced here, not just in
-- application code, so a bug or race in the caller can't bypass it.
--
-- Dependencies: requires service_visit_payments
-- (20260828100300_create_service_visit_payments.sql), service_visit_pricing,
-- and financial_audit_log (20260907090100_create_financial_audit_log.sql,
-- action_type already includes 'refund_issued') to already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement, no cron/side effect —
-- a single new function definition.
-- ============================================================================

create or replace function public.refund_visit_payment_with_audit(
  p_service_visit_payment_id uuid,
  p_refund_amount numeric(10, 2),
  p_stripe_refund_id text,
  p_actor_admin_user_id uuid,
  p_actor_role text,
  p_reason text
)
returns public.service_visit_payments
language plpgsql
set search_path = public
as $$
declare
  v_payment service_visit_payments;
  v_new_refunded_amount numeric(10, 2);
  v_new_status text;
begin
  if p_refund_amount <= 0 then
    raise exception 'refund_visit_payment_with_audit: p_refund_amount must be positive, got %', p_refund_amount;
  end if;

  select * into v_payment from service_visit_payments where id = p_service_visit_payment_id for update;

  if v_payment.id is null then
    raise exception 'service_visit_payments % not found', p_service_visit_payment_id;
  end if;

  if v_payment.status not in ('paid', 'partially_refunded') then
    raise exception 'service_visit_payments % is not eligible for refund (status=%, must be paid or partially_refunded)', p_service_visit_payment_id, v_payment.status;
  end if;

  v_new_refunded_amount := v_payment.refunded_amount + p_refund_amount;

  if v_new_refunded_amount > v_payment.total_amount then
    raise exception 'refund_visit_payment_with_audit: refund of % would exceed the remaining refundable balance (already refunded %, total %)', p_refund_amount, v_payment.refunded_amount, v_payment.total_amount;
  end if;

  v_new_status := case when v_new_refunded_amount >= v_payment.total_amount then 'refunded' else 'partially_refunded' end;

  update service_visit_payments
  set refunded_amount = v_new_refunded_amount,
      refunded_at = now(),
      status = v_new_status
  where id = p_service_visit_payment_id
  returning * into v_payment;

  update service_visit_pricing
  set payment_status = v_new_status
  where service_visit_id = v_payment.service_visit_id;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'refund_issued',
    'service_visit_payment', p_service_visit_payment_id, v_payment.service_visit_id,
    p_reason,
    jsonb_build_object(
      'refundAmount', p_refund_amount,
      'stripeRefundId', p_stripe_refund_id,
      'newStatus', v_new_status,
      'totalRefundedAmount', v_new_refunded_amount
    )
  );

  return v_payment;
end;
$$;

comment on function public.refund_visit_payment_with_audit(uuid, numeric, text, uuid, text, text) is
  'Atomically applies a refund to a service_visit_payments row (status -> partially_refunded/refunded, no-over-refund enforced, refundable only from paid/partially_refunded) AND records the required financial_audit_log actor-attribution row in one transaction. See src/lib/payments/refund-visit-payment.ts, the sole caller.';

revoke all on function public.refund_visit_payment_with_audit(uuid, numeric, text, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.refund_visit_payment_with_audit(uuid, numeric, text, uuid, text, text)
to service_role;
