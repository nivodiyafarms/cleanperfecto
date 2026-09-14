-- ============================================================================
-- Migration: service_fee_assessments collection columns + atomic RPC
-- Live-payment hardening milestone — Phase H (cancellation fee collection).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- service_fee_assessments (20260822091100) already distinguishes
-- ASSESSMENT (state='assessed', the obligation) from WAIVER
-- (state='waived', an owner-only financial correction — see
-- waive_service_fee_assessment_with_audit). This migration adds the third,
-- previously entirely unbuilt concept: COLLECTION — the fact that the
-- assessed fee was actually paid. state='paid' was already a valid value
-- in the original CHECK constraint (reserved, never reachable until now).
--
-- Extends the existing service_fee_assessments row directly rather than
-- creating a dedicated fee-payment table: unlike a Stripe refund (which
-- can happen in several independent partial events against one payment —
-- see why tax_reversal_reconciliations is its own table in
-- 20260914090300), a fee assessment is collected AT MOST ONCE, for its
-- one fixed `amount`, with no partial-collection concept anywhere in the
-- existing cancellation-policy design. Scalar columns on the same row
-- cannot lose information the way they would for a multi-event case, so
-- extending is the smaller, clean option here.
--
-- Deliberately mirrors record_external_visit_payment_with_audit's
-- "record what already happened" semantics, not create-and-attempt: the
-- admin only records collection AFTER money has already changed hands
-- via Zelle/Cash. There is no in-between "collection attempt" state and
-- therefore no way for a failed attempt to erase or alter the assessment —
-- the row simply stays state='assessed' until a real collection is
-- recorded. Real Stripe settlement (collection_method='stripe_card') is
-- schema-ready here (the CHECK constraint already allows it, and
-- stripe_payment_intent_id is reserved) but has no live caller yet — this
-- milestone has no off-session/automated-charge Stripe gateway capability
-- to call (VisitPaymentGateway only supports on-session, customer-present
-- flows), and PAYMENT_MODE is disabled. Building that gateway capability
-- and wiring an actual Stripe collection path is explicitly deferred to
-- when payment automation is separately authorized — same deferred-
-- linkage precedent as this table's own pre-existing payment_attempt_id
-- column.
--
-- This is intentionally NEVER netted against prepaid_packages or
-- service_visit_payments — a cancellation fee is assessed per-visit and
-- collected independently; collect_service_fee_assessment_with_audit
-- touches only service_fee_assessments and financial_audit_log, exactly
-- like waive_service_fee_assessment_with_audit before it, preserving the
-- finalized Phase G policy that a separately assessed fee is never
-- silently netted against a package refund.
--
-- Dependencies: requires service_fee_assessments
-- (20260822091100_create_service_fee_assessments.sql) and
-- financial_audit_log (20260907090100, widened by
-- 20260914090400_widen_financial_audit_log_action_type_for_tax_reversal.sql
-- to widen again here) to already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement — new nullable
-- columns, one new function, one constraint replacement.
-- ============================================================================

alter table public.service_fee_assessments
  add column collection_method text check (collection_method in ('zelle', 'cash', 'stripe_card')),
  add column external_payment_reference text,
  add column stripe_payment_intent_id text,
  add column collected_at timestamptz;

comment on column public.service_fee_assessments.collection_method is
  'Set exactly once, only by collect_service_fee_assessment_with_audit on a successful collection. stripe_card is schema-ready but has no live caller yet — no off-session Stripe charge capability exists in this milestone (see this migration''s own header comment).';

alter table public.financial_audit_log
  drop constraint financial_audit_log_action_type_check;

alter table public.financial_audit_log
  add constraint financial_audit_log_action_type_check
  check (action_type in (
    'external_payment_recorded',
    'fee_waived',
    'refund_issued',
    'financial_correction',
    'tax_override',
    'role_changed',
    'payment_configuration_changed',
    'tax_reversal_reconciled',
    'fee_collected'
  ));

-- ---------------------------------------------------------------------------
-- collect_service_fee_assessment_with_audit: mirrors
-- record_external_visit_payment_with_audit's and
-- waive_service_fee_assessment_with_audit's one-time-transition-plus-audit
-- convention exactly. Refundable-style over-collection is not applicable
-- (there is only ever one fixed `amount` to collect, never a caller-
-- supplied one) — the only guard needed is state='assessed', same as
-- waiver's own guard against re-acting on a non-assessed row.
-- ---------------------------------------------------------------------------

create or replace function public.collect_service_fee_assessment_with_audit(
  p_fee_assessment_id uuid,
  p_collection_method text,
  p_external_payment_reference text,
  p_stripe_payment_intent_id text,
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.service_fee_assessments
language plpgsql
set search_path = public
as $$
declare
  v_assessment service_fee_assessments;
begin
  if p_collection_method not in ('zelle', 'cash', 'stripe_card') then
    raise exception 'collect_service_fee_assessment_with_audit: invalid p_collection_method %', p_collection_method;
  end if;

  select * into v_assessment from service_fee_assessments where id = p_fee_assessment_id for update;

  if v_assessment.id is null then
    raise exception 'service_fee_assessments % not found', p_fee_assessment_id;
  end if;

  if v_assessment.state <> 'assessed' then
    raise exception 'service_fee_assessments % is not eligible for collection (state=%)', p_fee_assessment_id, v_assessment.state;
  end if;

  update service_fee_assessments
  set state = 'paid',
      collection_method = p_collection_method,
      external_payment_reference = p_external_payment_reference,
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      collected_at = now()
  where id = p_fee_assessment_id
  returning * into v_assessment;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'fee_collected',
    'service_fee_assessment', p_fee_assessment_id, v_assessment.service_visit_id,
    null,
    jsonb_build_object(
      'feeType', v_assessment.fee_type,
      'amount', v_assessment.amount,
      'collectionMethod', p_collection_method,
      'externalPaymentReference', p_external_payment_reference
    )
  );

  return v_assessment;
end;
$$;

comment on function public.collect_service_fee_assessment_with_audit(uuid, text, text, text, uuid, text) is
  'Atomically transitions a service_fee_assessments row to state=paid (collection — distinct from assessment and from waiver) AND records the required financial_audit_log actor-attribution row in one transaction. Refuses (raises) if the row is not currently state=assessed — no duplicate/over-collection, and a failed collection attempt never reaches this function at all, so the assessment is never erased by a payment failure. See src/lib/payments/collect-service-fee.ts, the sole caller.';

revoke all on function public.collect_service_fee_assessment_with_audit(uuid, text, text, text, uuid, text)
from public, anon, authenticated;

grant execute on function public.collect_service_fee_assessment_with_audit(uuid, text, text, text, uuid, text)
to service_role;
