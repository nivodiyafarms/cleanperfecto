-- ============================================================================
-- Migration: protect booking-level consent evidence from post-creation rewrite
-- Consent Evidence Audit — closes the gap empirically proven by local
-- rehearsal testing: booking_orders.consent_version_id,
-- cancellation_policy_version, cancellation_policy_text_snapshot,
-- payment_authorization_text_snapshot, and payment_authorization_accepted_at
-- had NO database-level protection — a direct UPDATE could silently
-- overwrite historical consent/payment evidence, including turning a
-- legacy NULL into a fabricated value. customer_consents already has this
-- protection (protect_customer_consents_after_signing); booking_orders did
-- not.
--
-- AUTHORED ONLY — DO NOT APPLY yet. Positioned after
-- 20260827090500_add_booking_level_consent_evidence.sql and before
-- 20260828100000 (first Group D migration) — a new file, not an edit to
-- any already-rehearsed Group C file.
--
-- Scope note: customer_id and booking_type were inspected as candidates
-- for the same protection (see the accompanying report) but are
-- deliberately NOT included here — expanding this migration's scope
-- beyond the five explicitly approved evidence fields requires a separate
-- decision, not a decision made inside this migration.
--
-- Same architecture/precedent as protect_booking_order_pricing_snapshot()
-- (20260818120200) and protect_customer_consents_after_signing()
-- (20260827090100): a BEFORE UPDATE trigger scoped with "OF <columns>" so
-- Postgres only fires it when one of the five named columns is part of the
-- UPDATE's target list at all — an update that never mentions these
-- columns (e.g. status alone) does not invoke this trigger, so it can
-- never freeze the whole row, only these five fields specifically. Inside
-- the trigger body, IS DISTINCT FROM comparisons (NULL-safe, so a NULL
-- staying NULL is not flagged, but NULL-to-value, value-to-NULL, and
-- value-to-different-value are all rejected identically) raise an
-- exception if any of the five actually changed value.
--
-- This does not affect INSERT at all (BEFORE UPDATE only) — a new booking
-- can still populate all five fields exactly as designed.
-- ============================================================================

create or replace function public.protect_booking_order_consent_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.consent_version_id is distinct from old.consent_version_id
    or new.cancellation_policy_version is distinct from old.cancellation_policy_version
    or new.cancellation_policy_text_snapshot is distinct from old.cancellation_policy_text_snapshot
    or new.payment_authorization_text_snapshot is distinct from old.payment_authorization_text_snapshot
    or new.payment_authorization_accepted_at is distinct from old.payment_authorization_accepted_at
  then
    raise exception
      'booking_orders consent evidence (consent_version_id, cancellation_policy_version, cancellation_policy_text_snapshot, payment_authorization_text_snapshot, payment_authorization_accepted_at) is immutable once set (id=%). A legacy NULL must remain honestly NULL rather than be filled in later, and a captured value can never be replaced — create a new booking order instead of modifying a historical one.',
      old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_booking_order_consent_evidence() is
  'BEFORE UPDATE OF (the five consent-evidence columns) guard: rejects any change to consent_version_id, cancellation_policy_version, cancellation_policy_text_snapshot, payment_authorization_text_snapshot, or payment_authorization_accepted_at once a row exists — NULL-to-value, value-to-NULL, and value-to-different-value are all rejected identically via IS DISTINCT FROM. Every other column (status, updated_at, etc.) remains freely updatable; this trigger is scoped with UPDATE OF so it never fires at all for an update that does not target one of these five columns.';

create trigger booking_orders_protect_consent_evidence
before update of
  consent_version_id,
  cancellation_policy_version,
  cancellation_policy_text_snapshot,
  payment_authorization_text_snapshot,
  payment_authorization_accepted_at
on public.booking_orders
for each row execute function public.protect_booking_order_consent_evidence();
