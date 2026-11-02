-- PREVIEW-ONLY follow-up (pitvmtsenkcuapixrilg). NOT for production.
-- Preview applied the earlier draft of 20261101120000 which replaced the shared
-- protect_service_visit_payments_financial_facts() and created current_customer_id() /
-- current_admin_is_owner(). This brings Preview in line with the revised migration.
begin;

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

create or replace function public.protect_referral_credit_amount()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tip_confirmed_at is not null
    and new.referral_credit_amount is distinct from old.referral_credit_amount
    and not (
      current_setting('app.allow_payment_revision_reset', true) = 'true'
      and new.status = 'created'
      and new.tip_confirmed_at is null
    )
  then
    raise exception
      'service_visit_payments financial facts are immutable once tip_confirmed_at is set (id=%)', old.id;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_referral_credit_amount() from public, anon, authenticated;
drop trigger if exists service_visit_payments_protect_referral_credit_amount on public.service_visit_payments;
create trigger service_visit_payments_protect_referral_credit_amount
before update on public.service_visit_payments
for each row execute function public.protect_referral_credit_amount();

alter function public.current_customer_id() rename to referral_current_customer_id;
alter function public.current_admin_is_owner() rename to referral_current_admin_is_owner;
-- RLS policies reference functions by OID, so they follow the rename automatically.

commit;
