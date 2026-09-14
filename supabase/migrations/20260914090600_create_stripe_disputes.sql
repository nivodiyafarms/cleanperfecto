-- ============================================================================
-- Migration: stripe_disputes table + guarded upsert RPC
-- Live-payment hardening milestone — Phase C (dispute lifecycle:
-- charge.dispute.created / .updated / .closed).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- No existing table can represent dispute state — service_visit_payments
-- is the payment FACT (frozen tip/tax/total, status, refund bookkeeping);
-- folding dispute state into it would violate the finalized policy that
-- "Dispute must NOT equal refund": opening a dispute must never make a
-- paid visit look unpaid or refunded, and a dispute's own status
-- (needs_response / under_review / won / lost / warning_*) has nothing to
-- do with the payment-status state machine service_visit_payments already
-- enforces (payment-status-transitions.ts). A dedicated table keeps both
-- fact trails legible on their own terms — same reasoning financial_audit_log's
-- own migration already used for not reusing service_visit_events.
--
-- dispute_status is deliberately free text, NOT a CHECK-constrained enum:
-- Stripe's own SDK type (Dispute.Status) already includes an explicit
-- forward-compatibility fallback for values Stripe may add later
-- ('lost' | 'needs_response' | 'prevented' | 'under_review' |
-- 'warning_closed' | 'warning_needs_response' | 'warning_under_review' |
-- 'won' | OtherString) — mirrors financial_audit_log.target_entity_type's
-- own "never force a second widening migration for a value Stripe controls"
-- convention.
--
-- Causal/monotonic guard: Stripe does not guarantee webhook delivery
-- order, and the SAME dispute can receive created/updated/closed events
-- out of order or redelivered. Rather than trying to model dispute status
-- as a linear state machine (it isn't one — Stripe can move a dispute
-- back to under_review after a merchant response), this table stores
-- last_stripe_event_created_at (the webhook EVENT's own `created`
-- timestamp, distinct from stripe_created_at, the DISPUTE's own creation
-- time, which never changes) and upsert_stripe_dispute_event() below only
-- ever applies an incoming event when its created timestamp is strictly
-- newer than what is already recorded — a stale/out-of-order/duplicate
-- webhook is a safe, silent no-op, and a dispute already closed by a
-- newer event can never be reopened by a late-arriving stale update.
--
-- Dependencies: requires service_visit_payments
-- (20260828100300_create_service_visit_payments.sql) to already be
-- applied (for the optional convenience join below).
--
-- Safety: no DROP/TRUNCATE, no destructive statement — a new table and
-- one new function definition.
-- ============================================================================

create table public.stripe_disputes (
  id uuid primary key default gen_random_uuid(),

  stripe_dispute_id text not null unique,
  stripe_charge_id text not null,
  stripe_payment_intent_id text,

  -- Convenience reference, resolved by upsert_stripe_dispute_event() from
  -- stripe_payment_intent_id — nullable because a disputed charge may not
  -- (or may no longer) map to a service_visit_payments row this codebase
  -- recognizes (e.g. a test-mode charge, or a charge from before this
  -- milestone). Never required for the dispute record itself to be valid.
  service_visit_payment_id uuid references public.service_visit_payments (id),
  service_visit_id uuid references public.service_visits (id),

  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null,
  dispute_status text not null,
  reason text,

  -- The DISPUTE's own creation time (Stripe's `dispute.created`) — set
  -- once, immutable. Never confused with last_stripe_event_created_at
  -- below, which tracks the latest WEBHOOK EVENT applied.
  stripe_created_at timestamptz not null,

  -- The causal/monotonic guard — see this migration's header comment.
  last_stripe_event_id text not null,
  last_stripe_event_created_at timestamptz not null,

  -- Set once dispute_status reaches a closed/terminal outcome (won, lost,
  -- warning_closed) — null while still open/under review.
  closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stripe_disputes is
  'Persisted charge.dispute.created/.updated/.closed facts — deliberately separate from service_visit_payments (a dispute must never make a paid visit look refunded/unpaid). Guarded by last_stripe_event_created_at so out-of-order or duplicate webhook deliveries can never regress a dispute''s recorded state. See src/lib/booking/webhook/process-stripe-webhook-event.ts, the sole writer (via upsert_stripe_dispute_event).';

comment on column public.stripe_disputes.dispute_status is
  'Free text, not CHECK-constrained — Stripe''s own SDK type already has an explicit fallback for future values it may add. Also represents the dispute''s outcome (won/lost) — Stripe does not expose a separate "outcome" field.';

comment on column public.stripe_disputes.last_stripe_event_created_at is
  'The webhook EVENT''s own created timestamp (not the dispute''s) — the sole causal/monotonic guard: an incoming event only applies if strictly newer than this.';

create index stripe_disputes_service_visit_payment_id_idx
  on public.stripe_disputes (service_visit_payment_id)
  where service_visit_payment_id is not null;

create index stripe_disputes_status_idx
  on public.stripe_disputes (dispute_status)
  where closed_at is null;

create trigger stripe_disputes_set_updated_at
before update on public.stripe_disputes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- upsert_stripe_dispute_event: the sole writer. Resolves
-- service_visit_payment_id/service_visit_id by stripe_payment_intent_id
-- (best-effort — a foreign/unknown intent leaves both null, same "safe
-- no-op for records we don't recognize" precedent as reconcileVisitPayment).
-- No financial_audit_log row is written here — this is pure Stripe-webhook-
-- driven fact recording (no admin actor), the same class of mutation as
-- reconcileVisitPayment's own plain, non-audited status updates.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_stripe_dispute_event(
  p_stripe_dispute_id text,
  p_stripe_charge_id text,
  p_stripe_payment_intent_id text,
  p_amount numeric(10, 2),
  p_currency text,
  p_dispute_status text,
  p_reason text,
  p_stripe_created_at timestamptz,
  p_stripe_event_id text,
  p_stripe_event_created_at timestamptz,
  p_is_closed boolean
)
returns public.stripe_disputes
language plpgsql
set search_path = public
as $$
declare
  v_existing stripe_disputes;
  v_service_visit_payment_id uuid;
  v_service_visit_id uuid;
begin
  select id, service_visit_id into v_service_visit_payment_id, v_service_visit_id
  from service_visit_payments
  where stripe_payment_intent_id = p_stripe_payment_intent_id;

  -- FOR UPDATE serializes concurrent deliveries for the SAME existing
  -- dispute: a second transaction blocks here until the first commits,
  -- then re-reads the now-current row before making its own staleness
  -- decision — no separate ON CONFLICT path (and its own race window) is
  -- needed for the existing-row case.
  select * into v_existing from stripe_disputes where stripe_dispute_id = p_stripe_dispute_id for update;

  if v_existing.id is not null then
    if v_existing.last_stripe_event_created_at >= p_stripe_event_created_at then
      -- Stale, duplicate, or out-of-order delivery — safe no-op, returns
      -- the unchanged current row rather than applying a regression.
      return v_existing;
    end if;

    update stripe_disputes
    set stripe_charge_id = p_stripe_charge_id,
        stripe_payment_intent_id = p_stripe_payment_intent_id,
        service_visit_payment_id = v_service_visit_payment_id,
        service_visit_id = v_service_visit_id,
        amount = p_amount,
        currency = p_currency,
        dispute_status = p_dispute_status,
        reason = p_reason,
        last_stripe_event_id = p_stripe_event_id,
        last_stripe_event_created_at = p_stripe_event_created_at,
        closed_at = case when p_is_closed then coalesce(v_existing.closed_at, now()) else v_existing.closed_at end
    where id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into stripe_disputes (
    stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id,
    service_visit_payment_id, service_visit_id,
    amount, currency, dispute_status, reason,
    stripe_created_at, last_stripe_event_id, last_stripe_event_created_at,
    closed_at
  ) values (
    p_stripe_dispute_id, p_stripe_charge_id, p_stripe_payment_intent_id,
    v_service_visit_payment_id, v_service_visit_id,
    p_amount, p_currency, p_dispute_status, p_reason,
    p_stripe_created_at, p_stripe_event_id, p_stripe_event_created_at,
    case when p_is_closed then now() else null end
  )
  returning * into v_existing;

  return v_existing;
end;
$$;

comment on function public.upsert_stripe_dispute_event(text, text, text, numeric, text, text, text, timestamptz, text, timestamptz, boolean) is
  'Insert-or-update a stripe_disputes row, guarded so an event only applies when strictly newer (by the webhook event''s own created timestamp) than what is already recorded — a stale/duplicate/out-of-order delivery is a safe no-op. See src/lib/booking/webhook/process-stripe-webhook-event.ts, the sole caller.';

alter table public.stripe_disputes enable row level security;

revoke all privileges
on table public.stripe_disputes
from anon, authenticated;

grant select, insert, update
on table public.stripe_disputes
to service_role;

revoke all on function public.upsert_stripe_dispute_event(text, text, text, numeric, text, text, text, timestamptz, text, timestamptz, boolean)
from public, anon, authenticated;

grant execute on function public.upsert_stripe_dispute_event(text, text, text, numeric, text, text, text, timestamptz, text, timestamptz, boolean)
to service_role;
