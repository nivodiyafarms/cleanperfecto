-- ============================================================================
-- Migration: tax_reversal_reconciliations table + atomic RPCs
-- Live-payment hardening milestone — Phase F.1 (durable Tax reversal
-- recovery), correcting a gap in Phase F: a Stripe Tax reversal failure was
-- previously only console.warn'd and then forgotten — a transient API
-- failure created a permanent accounting mismatch that existed only in
-- application logs, with no durable record and no retry path.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Why a dedicated table rather than extending service_visit_payments /
-- prepaid_packages with scalar reversal-status columns (the pattern
-- already used for the FORWARD tax-sync path's tax_transaction_status /
-- stripe_tax_transaction_id): a single service_visit_payments row can
-- accumulate MULTIPLE independent refund events over time (partial, then
-- partial, then full — already exercised by refund-visit-payment.test.ts),
-- and each one independently attempts its own Tax reversal. Scalar columns
-- on the parent row can only represent the LATEST attempt; a second refund
-- event's reversal would silently overwrite the first event's still-
-- pending/failed state, which is exactly the kind of accounting mismatch
-- this migration exists to prevent. One row per reversal-worthy refund
-- event, independently retriable, is the smallest model that stays correct
-- once more than one refund happens against the same payment or package.
--
-- target_entity_type/target_entity_id are a loose polymorphic reference
-- (service_visit_payments row or prepaid_packages row) rather than two
-- nullable FK columns, mirroring financial_audit_log's own
-- target_entity_type/target_entity_id convention one migration prior in
-- this same feature area — kept as free text (not a CHECK-constrained
-- enum) for the same reason financial_audit_log's is: a future entity type
-- should never require a second widening migration just to be referenced.
--
-- Dependencies: requires service_visit_payments (20260828100300),
-- prepaid_packages (20260818120500), and admin_users (20260823100000) to
-- already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement — a new table, one
-- freeze trigger, and three new function definitions.
-- ============================================================================

create table public.tax_reversal_reconciliations (
  id uuid primary key default gen_random_uuid(),

  -- Polymorphic reference to the refund event this reconciliation exists
  -- for. Not a FK (two possible parent tables) — see rationale above.
  target_entity_type text not null check (target_entity_type in ('service_visit_payment', 'prepaid_package')),
  target_entity_id uuid not null,

  -- Immutable once set (enforced by the trigger below) — the original
  -- Stripe Tax transaction being reversed. Never re-derived or re-fetched
  -- on retry; the whole point of persisting it here is that a retry never
  -- needs to ask Stripe/the application layer "what was I reversing?"
  -- again.
  original_transaction_id text not null,

  -- The dollar amount this specific reversal event concerns (the
  -- triggering refund's own amount — for a 'full' mode reversal this is
  -- the refund amount that made the payment/package fully refunded, kept
  -- for audit/traceability even though Stripe's own full-mode reversal
  -- call takes no dollar parameter). Immutable once set.
  intended_amount numeric(10, 2) not null check (intended_amount > 0),

  -- Immutable once set — which Stripe Tax reversal mode this event uses.
  mode text not null check (mode in ('full', 'partial')),

  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),

  -- Set exactly once, only on a successful Stripe reversal call. Immutable
  -- once set (enforced by the trigger below) — a successful reversal can
  -- never be silently replaced by a later one.
  stripe_reversal_id text,

  failure_message text,
  retry_count int not null default 0 check (retry_count >= 0),

  created_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  succeeded_at timestamptz
);

comment on table public.tax_reversal_reconciliations is
  'Durable recovery record for a Stripe Tax reversal owed against a specific refund event on either service_visit_payments or prepaid_packages. One row per refund event that had a committed original Tax transaction to reverse — never a scalar column on the parent row, so multiple independent refund events on the same payment/package can each be tracked and retried without overwriting one another. See src/lib/payments/attempt-tax-reversal.ts and retry-tax-reversal.ts, the only writers.';

comment on column public.tax_reversal_reconciliations.original_transaction_id is
  'The Stripe Tax transaction being reversed — captured once, immutable, never re-fetched on retry.';

comment on column public.tax_reversal_reconciliations.stripe_reversal_id is
  'Set exactly once on success. Immutable once set (see protect_tax_reversal_reconciliation_facts) — a succeeded reversal can never be executed or recorded twice.';

create index tax_reversal_reconciliations_target_idx
  on public.tax_reversal_reconciliations (target_entity_type, target_entity_id);

create index tax_reversal_reconciliations_status_idx
  on public.tax_reversal_reconciliations (status)
  where status <> 'succeeded';

-- ---------------------------------------------------------------------------
-- Freeze trigger: once a reversal event exists, its identity/amount facts
-- (which original transaction, how much, which mode, which parent record)
-- can never change — mirrors protect_service_visit_payments_financial_facts'
-- established convention in this codebase. Additionally, once status =
-- 'succeeded', the row is fully frozen (no further status/failure_message/
-- retry_count/stripe_reversal_id changes at all) — the DB-level backstop
-- for "successful reversal cannot be executed twice", independent of and
-- in addition to the application-layer idempotent no-op in
-- attempt-tax-reversal.ts and the RPC-level guard in
-- mark_tax_reversal_reconciliation_succeeded/failed below.
-- ---------------------------------------------------------------------------

create or replace function public.protect_tax_reversal_reconciliation_facts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.target_entity_type is distinct from old.target_entity_type
    or new.target_entity_id is distinct from old.target_entity_id
    or new.original_transaction_id is distinct from old.original_transaction_id
    or new.intended_amount is distinct from old.intended_amount
    or new.mode is distinct from old.mode
  then
    raise exception
      'tax_reversal_reconciliations identity/amount facts are immutable once created (id=%)', old.id;
  end if;

  if old.status = 'succeeded' then
    raise exception
      'tax_reversal_reconciliations % has already succeeded — a successful reversal can never be re-recorded', old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_tax_reversal_reconciliation_facts() is
  'BEFORE UPDATE guard: target/original_transaction_id/intended_amount/mode are immutable from creation, and once status=succeeded the row is fully frozen — DB-level enforcement that a successful Tax reversal can never be executed or recorded twice.';

create trigger protect_tax_reversal_reconciliation_facts
  before update on public.tax_reversal_reconciliations
  for each row
  execute function public.protect_tax_reversal_reconciliation_facts();

-- ---------------------------------------------------------------------------
-- create_tax_reversal_reconciliation: durably records intent to reverse
-- BEFORE the actual Stripe call is ever attempted — the core of F.1's
-- durability guarantee. Called once per refund event that has a committed
-- original Tax transaction; never called again for that same event
-- (retries operate on the existing row via the two functions below).
-- ---------------------------------------------------------------------------

create or replace function public.create_tax_reversal_reconciliation(
  p_target_entity_type text,
  p_target_entity_id uuid,
  p_original_transaction_id text,
  p_intended_amount numeric(10, 2),
  p_mode text
)
returns public.tax_reversal_reconciliations
language plpgsql
set search_path = public
as $$
declare
  v_row tax_reversal_reconciliations;
begin
  if p_target_entity_type not in ('service_visit_payment', 'prepaid_package') then
    raise exception 'create_tax_reversal_reconciliation: invalid p_target_entity_type %', p_target_entity_type;
  end if;
  if p_mode not in ('full', 'partial') then
    raise exception 'create_tax_reversal_reconciliation: invalid p_mode %', p_mode;
  end if;
  if p_intended_amount <= 0 then
    raise exception 'create_tax_reversal_reconciliation: p_intended_amount must be positive, got %', p_intended_amount;
  end if;

  insert into tax_reversal_reconciliations (
    target_entity_type, target_entity_id, original_transaction_id, intended_amount, mode
  ) values (
    p_target_entity_type, p_target_entity_id, p_original_transaction_id, p_intended_amount, p_mode
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_tax_reversal_reconciliation(text, uuid, text, numeric, text) is
  'Durably persists intent to reverse a Stripe Tax transaction, BEFORE the Stripe API call is attempted. See src/lib/payments/attempt-tax-reversal.ts, the sole caller.';

-- ---------------------------------------------------------------------------
-- mark_tax_reversal_reconciliation_succeeded: the only path that records a
-- financial_audit_log row for this feature — a successful reversal is a
-- real financial reconciliation fact worth auditing; a failed attempt is
-- transient/retriable and already fully visible via this table's own
-- status/failure_message/retry_count, so it is not separately audited
-- (mirroring retryExternalTaxSync's forward-sync precedent, which also
-- never writes financial_audit_log on failure).
--
-- Idempotent: if the row is already 'succeeded', this is a silent no-op
-- that returns the existing row unchanged and does NOT insert a second
-- audit row — "successful reversal cannot be executed twice" enforced
-- here as well as by the freeze trigger above.
-- ---------------------------------------------------------------------------

create or replace function public.mark_tax_reversal_reconciliation_succeeded(
  p_id uuid,
  p_stripe_reversal_id text,
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.tax_reversal_reconciliations
language plpgsql
set search_path = public
as $$
declare
  v_row tax_reversal_reconciliations;
begin
  select * into v_row from tax_reversal_reconciliations where id = p_id for update;

  if v_row.id is null then
    raise exception 'tax_reversal_reconciliations % not found', p_id;
  end if;

  if v_row.status = 'succeeded' then
    return v_row;
  end if;

  update tax_reversal_reconciliations
  set status = 'succeeded',
      stripe_reversal_id = p_stripe_reversal_id,
      succeeded_at = now(),
      last_attempted_at = now()
  where id = p_id
  returning * into v_row;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'tax_reversal_reconciled',
    'tax_reversal_reconciliation', p_id,
    case when v_row.target_entity_type = 'service_visit_payment' then
      (select service_visit_id from service_visit_payments where id = v_row.target_entity_id)
    else null end,
    null,
    jsonb_build_object(
      'outcome', 'succeeded',
      'targetEntityType', v_row.target_entity_type,
      'targetEntityId', v_row.target_entity_id,
      'originalTransactionId', v_row.original_transaction_id,
      'intendedAmount', v_row.intended_amount,
      'mode', v_row.mode,
      'stripeReversalId', p_stripe_reversal_id,
      'retryCount', v_row.retry_count
    )
  );

  return v_row;
end;
$$;

comment on function public.mark_tax_reversal_reconciliation_succeeded(uuid, text, uuid, text) is
  'Atomically records a successful Stripe Tax reversal AND the required financial_audit_log actor-attribution row in one transaction. Idempotent no-op (no second audit row) if already succeeded. See src/lib/payments/attempt-tax-reversal.ts, the sole caller.';

-- ---------------------------------------------------------------------------
-- mark_tax_reversal_reconciliation_failed: records a transient failure for
-- later retry. Deliberately does NOT write financial_audit_log — see the
-- comment above mark_tax_reversal_reconciliation_succeeded. Rejects
-- outright if the row already succeeded (a bug in the caller, not a normal
-- path — attempt-tax-reversal.ts never calls this once status='succeeded').
-- ---------------------------------------------------------------------------

create or replace function public.mark_tax_reversal_reconciliation_failed(
  p_id uuid,
  p_failure_message text
)
returns public.tax_reversal_reconciliations
language plpgsql
set search_path = public
as $$
declare
  v_row tax_reversal_reconciliations;
begin
  select * into v_row from tax_reversal_reconciliations where id = p_id for update;

  if v_row.id is null then
    raise exception 'tax_reversal_reconciliations % not found', p_id;
  end if;

  if v_row.status = 'succeeded' then
    raise exception 'tax_reversal_reconciliations % has already succeeded — cannot mark a succeeded reversal as failed', p_id;
  end if;

  update tax_reversal_reconciliations
  set status = 'failed',
      failure_message = p_failure_message,
      retry_count = retry_count + 1,
      last_attempted_at = now()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.mark_tax_reversal_reconciliation_failed(uuid, text) is
  'Records a transient Stripe Tax reversal failure for later retry — never writes financial_audit_log (see mark_tax_reversal_reconciliation_succeeded''s comment). See src/lib/payments/attempt-tax-reversal.ts, the sole caller.';

alter table public.tax_reversal_reconciliations enable row level security;

revoke all privileges
on table public.tax_reversal_reconciliations
from anon, authenticated;

grant select, insert, update
on table public.tax_reversal_reconciliations
to service_role;
-- No delete grant — a reconciliation record is never removed, only
-- transitioned in place, same convention as every other financial/audit
-- table in this schema.

revoke all on function public.create_tax_reversal_reconciliation(text, uuid, text, numeric, text)
from public, anon, authenticated;
grant execute on function public.create_tax_reversal_reconciliation(text, uuid, text, numeric, text)
to service_role;

revoke all on function public.mark_tax_reversal_reconciliation_succeeded(uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_tax_reversal_reconciliation_succeeded(uuid, text, uuid, text)
to service_role;

revoke all on function public.mark_tax_reversal_reconciliation_failed(uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_tax_reversal_reconciliation_failed(uuid, text)
to service_role;
