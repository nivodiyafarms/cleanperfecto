-- ============================================================================
-- Migration: create service_visit_payments
-- Pay-Per-Cleaning Charge & Payment Completion V1 milestone.
--
-- The payment-rail-neutral financial ledger for a completed visit's final
-- collectible amount (service/extras + voluntary tip + Stripe-calculated
-- tax). One row per service_visit (service_visit_id UNIQUE) — created once
-- the customer begins Review Charges, updated in place through Tip
-- selection, then frozen at Confirm & Pay (Stripe card) or at Admin's
-- Record External Payment (Zelle/Cash). Deliberately NOT Checkout-Session-
-- shaped like payment_attempts (which has a NOT NULL UNIQUE
-- stripe_checkout_session_id) — this is a genuinely different concept: a
-- server-initiated charge/settlement with no Checkout Session at all, on
-- some visits settled by a rail that isn't Stripe at all.
--
-- service_visit_pricing remains strictly the approved cleaning/service/
-- extras pricing record; tip is voluntary PAYMENT data and is never written
-- to that table. approved_amount here is a frozen COPY of
-- service_visit_pricing.amount_due_from_customer at the moment this row is
-- created, never a live re-read.
--
-- Freeze rule: tip_confirmed_at is the rail-neutral moment the customer's
-- (or, for an external settlement, the already-customer-selected) tip and
-- total become permanent — set at the customer's own Confirm & Pay click
-- (Stripe card) or by Admin's Record External Payment action (Zelle/Cash),
-- whichever happens first. Once set, the customer-facing financial facts
-- (approved_amount, tip_basis_amount, tip_selection_type, tip_percentage,
-- tip_amount, tax_amount, total_amount) can never change again — see
-- protect_service_visit_payments_financial_facts() below. Stripe-tax
-- BOOKKEEPING fields (stripe_tax_calculation_id, tax_calculation_expires_at,
-- tax_transaction_status, stripe_tax_transaction_id, and the failure
-- fields) are deliberately NOT frozen: tax-sync reconciliation must be able
-- to keep progressing (pending -> committed/failed, and a same-total
-- recreated Calculation after Stripe-side expiration) long after the
-- customer-facing amount is permanently fixed.
-- ============================================================================

create table public.service_visit_payments (
  id uuid primary key default gen_random_uuid(),

  service_visit_id uuid not null unique references public.service_visits (id),
  service_visit_pricing_id uuid not null references public.service_visit_pricing (id),

  -- Frozen customer-facing financial facts (see the freeze trigger below).
  approved_amount numeric(10, 2) not null check (approved_amount >= 0),
  tip_basis_amount numeric(10, 2) check (tip_basis_amount >= 0),
  tip_selection_type text check (tip_selection_type in ('percentage_15', 'percentage_20', 'percentage_25', 'custom')),
  tip_percentage numeric(5, 2),
  tip_amount numeric(10, 2) check (tip_amount is null or (tip_amount >= 0 and tip_amount <= 1000)),
  tax_amount numeric(10, 2) check (tax_amount >= 0),
  total_amount numeric(10, 2) check (total_amount >= 0),

  tip_selected_at timestamptz,
  tip_confirmed_at timestamptz,

  tax_location_snapshot jsonb,
  currency text not null default 'usd',

  -- Rail selector — nullable until actually resolved (a row may exist
  -- before any rail is chosen, e.g. while the customer is still on the Tip
  -- step with no saved card yet).
  payment_method_type text check (payment_method_type in ('stripe_card', 'zelle', 'cash')),

  -- Stripe-card specific — nullable; populated only for payment_method_type
  -- = 'stripe_card', resolved server-side only, never earlier than the
  -- moment the customer is actually about to pay by card.
  stripe_customer_id text,
  stripe_payment_method_id text,
  card_brand text,
  card_last4 text,
  stripe_payment_intent_id text unique,

  -- Stripe Tax bookkeeping — NOT customer-facing amounts, NOT frozen by the
  -- tip_confirmed_at trigger (see migration header).
  stripe_tax_calculation_id text,
  tax_calculation_expires_at timestamptz,
  tax_transaction_status text not null default 'not_applicable'
    check (tax_transaction_status in ('not_applicable', 'pending', 'committed', 'failed')),
  stripe_tax_transaction_id text,
  tax_transaction_failure_code text,
  tax_transaction_failure_message text,
  tax_transaction_last_attempt_at timestamptz,

  -- External-payment specific, Admin-only (never surfaced to the customer
  -- portal/receipt).
  external_payment_reference text,

  status text not null default 'created'
    check (status in (
      'created', 'processing', 'requires_action', 'paid', 'payment_failed',
      'partially_refunded', 'refunded', 'no_payment_due'
    )),

  -- Deterministic, rail-independent: "visit-payment:${serviceVisitId}:v1" —
  -- generated once at row creation, before any tax/tip amount exists, and
  -- reused verbatim as the Stripe idempotency key for every PaymentIntent
  -- creation retry.
  idempotency_key text not null unique,

  failure_code text,
  failure_message text,

  refunded_amount numeric(10, 2) not null default 0 check (refunded_amount >= 0),
  refunded_at timestamptz,
  paid_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_visit_payments is
  'One row per completed service_visit (service_visit_id UNIQUE) — the payment-rail-neutral final-charge ledger covering approved service/extras + voluntary tip + Stripe-calculated tax. Rail-agnostic: payment_method_type distinguishes stripe_card / zelle / cash, with Stripe-specific columns nullable for the latter two. Frozen at tip_confirmed_at (see protect_service_visit_payments_financial_facts) regardless of rail.';

comment on column public.service_visit_payments.approved_amount is
  'Frozen copy of service_visit_pricing.amount_due_from_customer at the moment this row was created — never a live re-read. Pre-tax, pre-tip.';

comment on column public.service_visit_payments.tip_basis_amount is
  'The pre-tax value tip percentages are computed against — service_visit_pricing.amount_due_from_customer for Pay Per Cleaning, or prepaid_packages.effective_price_per_visit + approved add_on_amount for a prepaid visit (never the prepaid visit''s own $0 amount_due_from_customer).';

comment on column public.service_visit_payments.tip_confirmed_at is
  'The rail-neutral financial freeze point — set at the customer''s own Confirm & Pay click (stripe_card) or at Admin''s Record External Payment action (zelle/cash), whichever happens first. Once non-null, the customer-facing financial fact columns can never change again (enforced by trigger, not merely convention).';

comment on column public.service_visit_payments.external_payment_reference is
  'Optional admin-entered note/reference for a Zelle/Cash settlement (e.g. a Zelle confirmation string). Admin-only — never read by any customer-facing query/page/receipt.';

comment on column public.service_visit_payments.tax_transaction_status is
  'not_applicable: no tax-reporting transaction is relevant yet (row not paid, or no_payment_due). pending: paid, tax-transaction commit not yet confirmed. committed: the Stripe Tax Transaction is confirmed (auto, via tax.associations.find, for stripe_card; explicit createFromCalculation for zelle/cash). failed: the tax-transaction commit attempt failed — the PAYMENT remains paid regardless; see tax_transaction_failure_code/_message and the Retry Tax Sync admin action, which only ever retries this field, never the payment fact.';

-- ---------------------------------------------------------------------------
-- Freeze rule: once tip_confirmed_at is set, the customer-facing financial
-- facts can never change again, for either rail. Stripe-tax bookkeeping
-- fields, status/failure fields, and refund fields are deliberately left
-- mutable so reconciliation/tax-sync/refund-webhook processing can keep
-- progressing after the fact. stripe_payment_intent_id is separately
-- guarded: settable exactly once from null, then immutable.
-- ---------------------------------------------------------------------------
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
  then
    raise exception
      'service_visit_payments.stripe_payment_intent_id is immutable once set (id=%)', old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_service_visit_payments_financial_facts() is
  'BEFORE UPDATE guard: once tip_confirmed_at is set, rejects any change to the customer-facing financial fact columns (never Stripe-tax bookkeeping, status, or refund fields, which must remain mutable for reconciliation). stripe_payment_intent_id is separately frozen once set, independent of tip_confirmed_at.';

create trigger service_visit_payments_protect_financial_facts
before update on public.service_visit_payments
for each row execute function public.protect_service_visit_payments_financial_facts();

create trigger service_visit_payments_set_updated_at
before update on public.service_visit_payments
for each row execute function public.set_updated_at();

create index service_visit_payments_service_visit_pricing_id_idx
  on public.service_visit_payments (service_visit_pricing_id);

alter table public.service_visit_payments enable row level security;

revoke all privileges
on table public.service_visit_payments
from anon, authenticated;

grant select, insert, update
on table public.service_visit_payments
to service_role;
-- No delete grant — a visit's payment record is never removed, only
-- superseded in place pre-freeze or frozen post-freeze, same convention as
-- every other financial/audit table in this schema.
