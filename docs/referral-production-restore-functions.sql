-- ROLLBACK TEMPLATE (do not run unless rolling back). Production numabqpfnigejtdwpxng.
-- The current referral migration does NOT replace any pre-existing function, so a clean
-- rollback only needs to remove what it added. Section A restores the one shared function
-- the EARLIER draft of this migration replaced (used for Preview pitvmtsenkcuapixrilg, and as a
-- safety net in production), copied verbatim from
-- supabase/migrations/20261018090200_widen_payment_freeze_trigger_for_revision_and_retry.sql.
-- Compare against the output of docs/referral-production-function-dump.sql before running.

begin;

-- Section A: restore shared function to its prior definition (same signature, same owner).
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

-- Section B (only for a full referral rollback): uncomment to remove referral objects.
-- drop trigger if exists service_visit_payments_protect_referral_credit_amount on public.service_visit_payments;
-- drop trigger if exists a_clear_referral_credit_when_payment_resets on public.service_visit_payments;
-- drop function if exists public.protect_referral_credit_amount();
-- drop function if exists public.clear_referral_credit_when_payment_resets();
-- Referral tables/columns/other functions: drop only after confirming no real referral data exists.

commit;
