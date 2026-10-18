-- ============================================================================
-- Migration: widen protect_service_visit_payments_financial_facts() for the
-- "Revise & Resend Final Total" revision reset AND the retry/revision
-- concurrency fix for begin_visit_payment_retry.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- This trigger already has two independent guard clauses (see
-- 20260828100300_create_service_visit_payments.sql and
-- 20260914090000_allow_dead_payment_intent_replacement.sql): frozen
-- financial facts once tip_confirmed_at is set, and stripe_payment_intent_id
-- immutable once set EXCEPT when the row's current status is
-- 'payment_failed' (a definitively dead attempt — that existing, unchanged
-- escape already covers every ordinary dead-intent replacement case and is
-- left exactly as-is here).
--
-- Two NEW, independently-gated, narrow escapes are added:
--
--   1. Revision full reset (clause 1 AND clause 2) — gated by the
--      session-local setting app.allow_payment_revision_reset, settable
--      only inside start_visit_pricing_revision's own transaction:
--        - clause 1 (frozen financial facts): permitted only when the new
--          row shape is exactly new.status = 'created' AND
--          new.tip_confirmed_at IS NULL — the intended full-reset target,
--          never "anything goes while the flag is set."
--        - clause 2 (stripe_payment_intent_id): permitted only when
--          new.stripe_payment_intent_id IS NULL — clearing only, never
--          setting a different non-null value through this escape.
--
--   2. Retry intent-clear (clause 2 ONLY) — gated by a SEPARATE
--      session-local setting, app.allow_payment_retry_intent_clear,
--      settable only inside begin_visit_payment_retry's own transaction.
--      Deliberately a distinct flag from the revision's own, so
--      begin_visit_payment_retry can never, even in principle, reach
--      clause 1's escape — it never sets app.allow_payment_revision_reset,
--      so every financial fact (approved_amount, every tip_*, tax_amount,
--      total_amount, tip_confirmed_at) and the row's status column (not
--      guarded by either clause, see below) are a trigger-level invariant
--      for this path, not merely caller discipline. Needed because the
--      local row status at retry time may still be 'processing' (the
--      canceling webhook has not landed yet) or already 'payment_failed'
--      (it has) — the existing payment_failed-only escape does not cover
--      the former, and begin_visit_payment_retry must work correctly
--      regardless of that race, per the fresh-Stripe-retrieve-is-ground-
--      truth principle already established for startVisitPricingRevision.
--      Permitted only when new.stripe_payment_intent_id IS NULL — exactly
--      the same "clearing only" shape as the revision's own clause-2
--      escape.
--
-- Note: service_visit_payments.status itself is not, and has never been,
-- guarded by either clause — see the original trigger. begin_visit_payment_
-- retry's transition to 'processing' needs no new escape for that reason.
--
-- Dependencies: requires service_visit_payments
-- (20260828100300_create_service_visit_payments.sql,
-- 20260914090000_allow_dead_payment_intent_replacement.sql) to already be
-- applied.
--
-- Safety: no DROP/TRUNCATE — a single function replacement (CREATE OR
-- REPLACE, same signature, same return type).
-- ============================================================================

create or replace function public.protect_service_visit_payments_financial_facts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tip_confirmed_at is not null then
    if (
        new.service_visit_id is distinct from old.service_visit_id
        or new.service_visit_pricing_id is distinct from old.service_visit_pricing_id
        or new.approved_amount is distinct from old.approved_amount
        or new.tip_basis_amount is distinct from old.tip_basis_amount
        or new.tip_selection_type is distinct from old.tip_selection_type
        or new.tip_percentage is distinct from old.tip_percentage
        or new.tip_amount is distinct from old.tip_amount
        or new.tax_amount is distinct from old.tax_amount
        or new.total_amount is distinct from old.total_amount
        or new.tip_confirmed_at is distinct from old.tip_confirmed_at
      )
      and not (
        current_setting('app.allow_payment_revision_reset', true) = 'true'
        and new.status = 'created'
        and new.tip_confirmed_at is null
      )
    then
      raise exception
        'service_visit_payments financial facts are immutable once tip_confirmed_at is set (id=%)', old.id;
    end if;
  end if;

  if old.stripe_payment_intent_id is not null
    and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
    and old.status is distinct from 'payment_failed'
    and not (current_setting('app.allow_payment_revision_reset', true) = 'true' and new.stripe_payment_intent_id is null)
    and not (current_setting('app.allow_payment_retry_intent_clear', true) = 'true' and new.stripe_payment_intent_id is null)
  then
    raise exception
      'service_visit_payments.stripe_payment_intent_id can only be replaced when the prior attempt is dead (status=payment_failed), or cleared via start_visit_pricing_revision/begin_visit_payment_retry; current status=% (id=%)', old.status, old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_service_visit_payments_financial_facts() is
  'BEFORE UPDATE guard: once tip_confirmed_at is set, rejects any change to the customer-facing financial fact columns UNLESS app.allow_payment_revision_reset is active and the new row is exactly the full-reset shape (status=created, tip_confirmed_at=null) — settable only by start_visit_pricing_revision. stripe_payment_intent_id is separately frozen once set, EXCEPT it may be replaced when the row''s current status is payment_failed (a definitively dead attempt), or cleared to null under app.allow_payment_revision_reset (the same full reset) or app.allow_payment_retry_intent_clear (begin_visit_payment_retry''s own narrow escape, independent of the revision flag so it can never reach clause 1).';
