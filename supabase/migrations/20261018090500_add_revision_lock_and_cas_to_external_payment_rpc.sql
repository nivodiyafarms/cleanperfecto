-- ============================================================================
-- Migration: widen record_external_visit_payment_with_audit() with the
-- shared advisory lock, a price_status/revision guard, and a new amount
-- compare-and-swap for the "Record Cash/Zelle Payment Received" feature.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Three additive changes to the existing RPC (unchanged signature and
-- behavior for every existing caller that omits the three new, all-optional
-- trailing parameters):
--
--   1. The SAME advisory lock as claim_visit_payment_attempt/
--      begin_visit_payment_retry/start_visit_pricing_revision
--      (hashtextextended('visit_payment_claim:' || service_visit_id, 0)),
--      acquired first (after resolving service_visit_id from the given
--      payment id — a plain pre-lock read used only to learn the lock key,
--      never to decide anything). No two-phase split needed here (unlike
--      the card-payment case) — this RPC has no external API call in the
--      middle, so claim-and-settle stays one atomic transaction, exactly
--      as it already is.
--   2. Refuses (raises 'revision_in_progress') if the visit's pricing is
--      currently mid-revision — closing the same concurrent-payment race
--      start_visit_pricing_revision itself is built to close, now from the
--      external-settlement side too.
--   3. A new, optional revision-number + total/tip-amount compare-and-swap
--      (p_expected_revision_number, p_expected_total_amount,
--      p_expected_tip_amount) — folded directly into the SAME UPDATE
--      statement that flips status to 'paid' (never a separate check-then-
--      write pair, which would still be racy against a concurrent,
--      non-lock-aware selectVisitTip call — see recordCashOrZellePayment,
--      the sole caller that supplies these three). When any one of the
--      three no longer matches a fresh read AT THE MOMENT this statement
--      runs, zero rows match and the call raises 'stale_pricing_version'
--      rather than ever settling a stale total/tip as paid. Omitted
--      (null) by every other existing caller, which gets the exact
--      original, unconditional behavior.
--
-- Dependencies: requires record_external_visit_payment_with_audit
-- (20260907090200_create_record_external_visit_payment_with_audit_function.sql)
-- and the revision-window columns (20261018090000) to already be applied.
--
-- Safety: no TRUNCATE, no data mutation. Adding parameters changes this
-- function's signature (argument count), which Postgres treats as a
-- DIFFERENT overload rather than something CREATE OR REPLACE can replace
-- in place — a plain CREATE OR REPLACE here would silently leave the
-- original 5-argument function registered alongside a new, never-called
-- 8-argument one, and every existing exact-5-argument call site would keep
-- resolving to the unmodified original (exact-arity matches win over
-- defaulted-argument matches in Postgres's overload resolution), bypassing
-- the lock/guard/CAS entirely. The DROP below is therefore required, not
-- optional, to actually replace the one real function every caller uses —
-- same technique as 20261016090600_fix_agreed_quote_claim_functions_setof.sql,
-- which hit the equivalent bare-composite/SETOF version of this same
-- pitfall.
-- ============================================================================

drop function if exists public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text);

create function public.record_external_visit_payment_with_audit(
  p_service_visit_payment_id uuid,
  p_payment_method_type text,
  p_external_payment_reference text,
  p_actor_admin_user_id uuid,
  p_actor_role text,
  p_expected_revision_number integer default null,
  p_expected_total_amount numeric default null,
  p_expected_tip_amount numeric default null
)
returns public.service_visit_payments
language plpgsql
set search_path = public
as $$
declare
  v_service_visit_id uuid;
  v_payment service_visit_payments;
begin
  if p_payment_method_type not in ('zelle', 'cash') then
    raise exception 'record_external_visit_payment_with_audit: payment_method_type must be zelle or cash, got %', p_payment_method_type;
  end if;

  select service_visit_id into v_service_visit_id
  from service_visit_payments
  where id = p_service_visit_payment_id;

  if v_service_visit_id is null then
    raise exception 'service_visit_payments % not found', p_service_visit_payment_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('visit_payment_claim:' || v_service_visit_id::text, 0));

  if exists (
    select 1 from service_visit_pricing
    where service_visit_id = v_service_visit_id and price_status = 'revision_in_progress'
  ) then
    raise exception 'revision_in_progress';
  end if;

  update service_visit_payments svp
  set payment_method_type = p_payment_method_type,
      external_payment_reference = p_external_payment_reference,
      status = 'paid',
      paid_at = now(),
      tax_transaction_status = 'pending'
  where svp.id = p_service_visit_payment_id
    and svp.status = 'created'
    and (p_expected_total_amount is null or svp.total_amount is not distinct from p_expected_total_amount)
    and (p_expected_tip_amount is null or svp.tip_amount is not distinct from p_expected_tip_amount)
    and (
      p_expected_revision_number is null
      or exists (
        select 1 from service_visit_pricing svpr
        where svpr.service_visit_id = svp.service_visit_id
          and svpr.revision_number is not distinct from p_expected_revision_number
      )
    )
  returning * into v_payment;

  if v_payment.id is null then
    if (p_expected_revision_number is not null or p_expected_total_amount is not null or p_expected_tip_amount is not null)
      and exists (select 1 from service_visit_payments where id = p_service_visit_payment_id and status = 'created')
    then
      raise exception 'stale_pricing_version';
    end if;
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

comment on function public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text, integer, numeric, numeric) is
  'Atomically settles an external (zelle/cash) service_visit_payments row AND records the required financial_audit_log actor-attribution row in one transaction — either both commit or neither does. Also acquires the shared visit_payment_claim advisory lock and refuses while a revision is in progress, and — when the three trailing CAS parameters are supplied (see recordCashOrZellePayment, src/lib/payments/record-cash-or-zelle-payment.ts) — refuses with ''stale_pricing_version'' unless the row''s current revision_number/total_amount/tip_amount still match what the caller validated, folded into the same settling UPDATE so a concurrent tip change or revision start can only ever produce a refusal, never a stale amount recorded as paid. See src/lib/payments/record-external-payment.ts, the sole caller.';

revoke all on function public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text, integer, numeric, numeric)
from public, anon, authenticated;

grant execute on function public.record_external_visit_payment_with_audit(uuid, text, text, uuid, text, integer, numeric, numeric)
to service_role;
