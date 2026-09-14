-- ============================================================================
-- Migration: prepaid_packages refund columns + cancel_prepaid_package_with_refund_audit()
-- Live-payment hardening milestone — Phase G (prepaid package refunds).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Finalized business policy (owner-approved): a prepaid 6-cleaning package
-- may be canceled before all credits are used. Unused genuine visit
-- credits are refundable to the original payment method, at the ACTUAL
-- discounted prepaid value originally paid — never a current-price
-- recalculation, and completed visits are never retroactively repriced.
-- Refundable package principal = package_total_paid * (remaining_visit_count
-- / purchased_visit_count), computed from the immutable original
-- package_total_paid snapshot. Tips, separately-paid add-ons/travel/
-- supplies, and other per-visit charges are never part of this — those
-- were never part of package_total_paid to begin with. A separately
-- assessed cancellation fee (service_fee_assessments) is never netted
-- against this refund.
--
-- Adds the refund/cancellation bookkeeping columns prepaid_packages did
-- not previously have (it only recorded status='cancelled' with no record
-- of what, if anything, was refunded).
-- ============================================================================

alter table public.prepaid_packages
  add column refunded_amount numeric(10, 2) not null default 0 check (refunded_amount >= 0),
  add column refunded_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancellation_reason text;

comment on column public.prepaid_packages.refunded_amount is
  'Set once, at cancellation, by cancel_prepaid_package_with_refund_audit() — the exact dollar amount refunded to the original payment method for unused visit credits. 0 when all purchased visits had already been completed (nothing left to refund) or the package was canceled with no refund. Never touched afterward — a package is canceled exactly once. Cannot exceed package_total_paid — enforced by the function, not a CHECK constraint here, since that would need cross-column comparison.';

-- ---------------------------------------------------------------------------
-- Mirrors the existing atomic-RPC convention (record_external_visit_payment_with_audit,
-- refund_visit_payment_with_audit): the cancellation state transition AND
-- the required financial_audit_log actor-attribution row commit in one
-- transaction. `for update` row-locks the package for the duration of the
-- transaction, and only status='active' is eligible — a package can be
-- canceled exactly once (no double refund), and restoring a canceled
-- package is out of scope (would need a separate explicit correction flow,
-- per the finalized policy).
--
-- p_refund_amount may be exactly 0 (all 6 visits already completed —
-- nothing left to refund) — unlike refund_visit_payment_with_audit's
-- per-visit refund (always a deliberate positive admin choice), a
-- package-cancellation refund amount is a DERIVED, deterministic quantity
-- that can legitimately be zero, so this function accepts >= 0, not > 0.
-- Application code (refund-prepaid-package.ts) skips the actual Stripe
-- refund call entirely when the computed amount is 0, but still records
-- the cancellation via this same RPC for a single consistent audit trail.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_prepaid_package_with_refund_audit(
  p_prepaid_package_id uuid,
  p_refund_amount numeric(10, 2),
  p_stripe_refund_id text,
  p_actor_admin_user_id uuid,
  p_actor_role text,
  p_reason text
)
returns public.prepaid_packages
language plpgsql
set search_path = public
as $$
declare
  v_package prepaid_packages;
begin
  if p_refund_amount < 0 then
    raise exception 'cancel_prepaid_package_with_refund_audit: p_refund_amount must be >= 0, got %', p_refund_amount;
  end if;

  select * into v_package from prepaid_packages where id = p_prepaid_package_id for update;

  if v_package.id is null then
    raise exception 'prepaid_packages % not found', p_prepaid_package_id;
  end if;

  if v_package.status != 'active' then
    raise exception 'prepaid_packages % is not eligible for cancellation (status=%, must be active)', p_prepaid_package_id, v_package.status;
  end if;

  if p_refund_amount > v_package.package_total_paid then
    raise exception 'cancel_prepaid_package_with_refund_audit: refund of % would exceed the original package principal % (id=%)', p_refund_amount, v_package.package_total_paid, p_prepaid_package_id;
  end if;

  update prepaid_packages
  set status = 'cancelled',
      refunded_amount = p_refund_amount,
      refunded_at = case when p_refund_amount > 0 then now() else refunded_at end,
      cancelled_at = now(),
      cancellation_reason = p_reason
  where id = p_prepaid_package_id
  returning * into v_package;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'refund_issued',
    'prepaid_package', p_prepaid_package_id, null,
    p_reason,
    jsonb_build_object(
      'refundAmount', p_refund_amount,
      'stripeRefundId', p_stripe_refund_id,
      'packageTotalPaid', v_package.package_total_paid,
      'purchasedVisitCount', v_package.purchased_visit_count,
      'remainingVisitCountAtCancellation', v_package.remaining_visit_count
    )
  );

  return v_package;
end;
$$;

comment on function public.cancel_prepaid_package_with_refund_audit(uuid, numeric, text, uuid, text, text) is
  'Atomically cancels a prepaid_packages row (status -> cancelled, no-double-cancel enforced via status=active precondition, refund never exceeds package_total_paid) AND records the required financial_audit_log actor-attribution row in one transaction. See src/lib/payments/refund-prepaid-package.ts, the sole caller.';

revoke all on function public.cancel_prepaid_package_with_refund_audit(uuid, numeric, text, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.cancel_prepaid_package_with_refund_audit(uuid, numeric, text, uuid, text, text)
to service_role;
