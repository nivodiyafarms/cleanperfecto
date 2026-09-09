-- ============================================================================
-- Migration: protect booking_orders.customer_id and booking_type from
--            post-creation rewrite
-- Consent Evidence Audit — final identity-evidence hardening. Closes the
-- last remaining gap identified while reviewing 20260827090600's scope:
-- customer_id identifies WHO the booking-level consent/payment evidence
-- (consent_version_id, cancellation_policy_version,
-- cancellation_policy_text_snapshot, payment_authorization_text_snapshot,
-- payment_authorization_accepted_at) belongs to; booking_type determines
-- WHICH payment-authorization semantics applied (normal/Pay-Per-Cleaning
-- vs prepaid_package — see SAVED_PAYMENT_AUTHORIZATION_COPY vs
-- PREPAID_PAYMENT_AUTHORIZATION_COPY in cancellation-policy.ts). Neither
-- field had any existing protection: no trigger, no constraint, and no
-- application code path ever updates either after creation (the only
-- update method anywhere in the codebase, updateBookingOrderStatus,
-- touches status alone).
--
-- AUTHORED ONLY — DO NOT APPLY yet. Positioned after
-- 20260827090600_protect_booking_consent_evidence.sql and before
-- 20260828100000 (first Group D migration) — a new file.
-- 20260827090600 is NOT modified.
--
-- Semantics (explicit, not merely a technical write-once rule):
--   customer_id must remain the original customer this booking was
--   created for. A future customer-account-merge feature must not
--   accomplish a merge by rewriting historical booking_orders.customer_id
--   — that would silently re-attribute historical consent/payment
--   evidence to a different customer identity than the one who actually
--   accepted it. A merge feature needs its own separate canonical/mapping
--   architecture, not a mutation here.
--   booking_type must remain the type the booking was actually created
--   as. A normal booking can never become prepaid (or vice versa) by
--   mutating this column, since doing so would make the already-frozen
--   payment_authorization_text_snapshot internally contradictory (it
--   would then describe payment mechanics that were never true for the
--   type the row claims to be). Any real conversion between the two
--   models is a new, explicit transaction/amendment — never an edit to
--   historical booking evidence.
--
-- Same architecture as 20260827090600: a BEFORE UPDATE OF trigger scoped
-- to exactly these two columns, so Postgres only invokes it when
-- customer_id or booking_type is part of the UPDATE's target list at all
-- — an update that only touches status (or any other column) never fires
-- this trigger and is completely unaffected. IS DISTINCT FROM is NULL-safe
-- and also correctly allows a same-value UPDATE (old = new) to pass
-- through as a no-op change, never a false rejection.
-- ============================================================================

create or replace function public.protect_booking_order_identity_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.customer_id is distinct from old.customer_id
    or new.booking_type is distinct from old.booking_type
  then
    raise exception
      'booking_orders identity evidence (customer_id, booking_type) is immutable once set (id=%). customer_id must remain the original customer this booking was created for, and booking_type must remain the originally-created booking type — rewriting either would misattribute or invalidate the frozen consent/payment evidence tied to this row. A customer-account merge must use a separate mapping architecture; a booking-model conversion must be a new transaction/amendment, never a rewrite of historical booking evidence.',
      old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_booking_order_identity_evidence() is
  'BEFORE UPDATE OF (customer_id, booking_type) guard: rejects any change to either column once a booking_orders row exists, via IS DISTINCT FROM (NULL-safe; a same-value UPDATE is correctly a no-op, not a false rejection). Every other column (status, updated_at, the five consent-evidence columns already protected by booking_orders_protect_consent_evidence, etc.) is unaffected — this trigger is scoped with UPDATE OF so it never fires for an update that does not target customer_id or booking_type.';

create trigger booking_orders_protect_identity_evidence
before update of customer_id, booking_type
on public.booking_orders
for each row execute function public.protect_booking_order_identity_evidence();
