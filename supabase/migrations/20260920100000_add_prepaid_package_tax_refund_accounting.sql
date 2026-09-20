-- ============================================================================
-- Migration: prepaid_packages tax-refund accounting columns + extend
-- cancel_prepaid_package_with_refund_audit() to refund tax proportionally
-- Live-payment hardening milestone — Phase H.2 (prepaid package tax refund
-- investigation).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Root cause: the existing prepaid-package cancellation refund
-- (refund-prepaid-package.ts, 20260914090200) refunds only the unused
-- package principal (package_total_paid * remaining/purchased). It never
-- refunds the proportional share of the Stripe Tax collected on that same
-- unused portion, so a customer who cancels early keeps paying tax on
-- cleanings they never received.
--
-- Real Stripe TEST mode investigation (owner-directed, this milestone)
-- established: a prepaid package's PaymentIntent is created by a Checkout
-- Session with automatic_tax (create-prepaid-package-checkout.ts). Per
-- Stripe's own Tax reporting documentation (docs.stripe.com/tax/reports —
-- "The following operations decrease the balance of total tax reported" —
-- lists "Creating a refund of a charge associated with an invoice or a
-- Checkout Session" as its own, independent bullet, distinct from
-- "Creating a reversal of a tax transaction using the Stripe Tax API"),
-- Stripe automatically adjusts its own Tax reporting for a Checkout-Session
-- charge the moment an ordinary Refund is created against it — no
-- tax.transactions.createReversal call applies to or is needed for a
-- Checkout-originated charge. (That API is exclusively for the separate,
-- manual PaymentIntent + Tax-Calculation integration used by this
-- codebase's per-visit flow — confirmed empirically: stripe.tax.
-- associations.find() returns "no associated tax calculation" for every
-- Checkout-originated PaymentIntent, live-tested against two independent
-- real TEST-mode prepaid packages.) Calling createReversal for a prepaid
-- package would therefore be both impossible (no association to find) and,
-- if it ever somehow succeeded, a DOUBLE reversal on top of what the
-- ordinary refund already adjusts.
--
-- The fix (refund-prepaid-package.ts, this same commit) computes
-- refundable tax the same way as refundable principal — tax_amount *
-- (remaining/purchased), rounded independently via roundToCents, verified
-- equivalent to pure-integer-cent arithmetic at this scale — and issues
-- ONE combined Stripe refund (principal + tax) against the original
-- PaymentIntent. It no longer calls findTaxAssociation/createReversal for
-- prepaid packages at all (that block was Phase F.1's, written before this
-- investigation proved it can never apply to a Checkout-originated
-- package); the per-visit flow's own reversal path is untouched.
--
-- These new columns mirror the purchase-side accounting added in
-- 20260918100000: principal and tax are tracked as separate, immutable-
-- once-set facts, with a third authoritative field read directly from
-- Stripe's own refund response rather than derived by local addition.
-- ============================================================================

alter table public.prepaid_packages
  add column refunded_tax_amount numeric(10, 2) not null default 0 check (refunded_tax_amount >= 0),
  add column total_refunded_amount numeric(10, 2);

comment on column public.prepaid_packages.refunded_tax_amount is
  'Set once, at cancellation, by cancel_prepaid_package_with_refund_audit() — the proportional share of the original tax_amount refunded for unused visit credits (tax_amount * remaining/purchased, rounded independently of refunded_amount). 0 when tax_amount was null at purchase (legacy package, or TAX_MODE disabled) or when nothing was refunded. Never touched afterward — a package is canceled exactly once. Cannot exceed the original tax_amount — enforced by the function.';

comment on column public.prepaid_packages.total_refunded_amount is
  'The exact amount Stripe actually refunded (refunded_amount + refunded_tax_amount, in a single combined Stripe refund), read back directly from Stripe''s own refund response — the authoritative cross-check, never derived by addition at read time. Null when nothing was refunded yet, or for packages cancelled before this column existed (their refunded_amount alone is the full historical fact — no tax was ever refunded for them, since this fix did not exist yet).';

-- ---------------------------------------------------------------------------
-- Signature change: adds p_refund_tax_amount and p_total_refund_amount.
-- Must drop before recreate — Postgres treats a different parameter list as
-- a new overload rather than a replacement, which would leave the old
-- 6-argument version callable and ambiguous alongside this one.
-- ---------------------------------------------------------------------------

drop function if exists public.cancel_prepaid_package_with_refund_audit(uuid, numeric, text, uuid, text, text);

create or replace function public.cancel_prepaid_package_with_refund_audit(
  p_prepaid_package_id uuid,
  p_refund_amount numeric(10, 2),
  p_refund_tax_amount numeric(10, 2),
  p_total_refund_amount numeric(10, 2),
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

  if p_refund_tax_amount < 0 then
    raise exception 'cancel_prepaid_package_with_refund_audit: p_refund_tax_amount must be >= 0, got %', p_refund_tax_amount;
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

  -- A null tax_amount (legacy package, or TAX_MODE disabled at purchase)
  -- means no tax was ever tracked for this package — no tax refund can be
  -- attributed to it, regardless of what the caller passes.
  if v_package.tax_amount is null then
    if p_refund_tax_amount != 0 then
      raise exception 'cancel_prepaid_package_with_refund_audit: prepaid_packages % has no recorded tax_amount — p_refund_tax_amount must be 0, got %', p_prepaid_package_id, p_refund_tax_amount;
    end if;
  elsif p_refund_tax_amount > v_package.tax_amount then
    raise exception 'cancel_prepaid_package_with_refund_audit: tax refund of % would exceed the original tax_amount % (id=%)', p_refund_tax_amount, v_package.tax_amount, p_prepaid_package_id;
  end if;

  update prepaid_packages
  set status = 'cancelled',
      refunded_amount = p_refund_amount,
      refunded_tax_amount = p_refund_tax_amount,
      total_refunded_amount = case when p_total_refund_amount is not null then p_total_refund_amount else total_refunded_amount end,
      refunded_at = case when p_refund_amount > 0 or p_refund_tax_amount > 0 then now() else refunded_at end,
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
      'refundTaxAmount', p_refund_tax_amount,
      'totalRefundAmount', p_total_refund_amount,
      'stripeRefundId', p_stripe_refund_id,
      'packageTotalPaid', v_package.package_total_paid,
      'taxAmount', v_package.tax_amount,
      'purchasedVisitCount', v_package.purchased_visit_count,
      'remainingVisitCountAtCancellation', v_package.remaining_visit_count
    )
  );

  return v_package;
end;
$$;

comment on function public.cancel_prepaid_package_with_refund_audit(uuid, numeric, numeric, numeric, text, uuid, text, text) is
  'Atomically cancels a prepaid_packages row (status -> cancelled, no-double-cancel enforced via status=active precondition, principal and tax refunds each bounded by their own original amount) AND records the required financial_audit_log actor-attribution row in one transaction. See src/lib/payments/refund-prepaid-package.ts, the sole caller.';

revoke all on function public.cancel_prepaid_package_with_refund_audit(uuid, numeric, numeric, numeric, text, uuid, text, text)
from public, anon, authenticated;

grant execute on function public.cancel_prepaid_package_with_refund_audit(uuid, numeric, numeric, numeric, text, uuid, text, text)
to service_role;
