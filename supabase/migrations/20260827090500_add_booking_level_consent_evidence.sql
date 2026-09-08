-- ============================================================================
-- Migration: add booking-level consent evidence to booking_orders
-- Final booking-level consent evidence audit — closes the last gap: the
-- combined clickwrap checkbox is accepted PER BOOKING, but booking_orders
-- itself carried no pointer to which consent_versions row applied, and no
-- durable snapshot of the exact cancellation-policy wording shown.
--
-- AUTHORED ONLY — DO NOT APPLY yet. Positioned after
-- 20260827090400_add_consent_acceptance_method_and_payment_authorization_snapshot.sql
-- and before 20260828100000 (first Group D migration) — a new file, not an
-- edit to any already-rehearsed Group C file.
--
-- Architecture (unchanged from the prior audit, now made explicit in the
-- schema itself):
--   customer_consents = CUSTOMER-level durable evidence that the customer
--     accepted a particular Service Terms version — unique per (customer,
--     version), never duplicated per booking. Stays exactly as designed.
--   booking_orders = BOOKING-level evidence of the one combined checkbox
--     for that specific transaction: which Service Terms version applied
--     (consent_version_id, new below), the exact cancellation-policy
--     wording shown (cancellation_policy_text_snapshot, new below), the
--     exact payment-authorization wording shown
--     (payment_authorization_text_snapshot, added 20260827090400), and the
--     single acceptance instant (payment_authorization_accepted_at,
--     existing — see its updated comment below). These two tables are
--     deliberately never contradictory: application code writes
--     booking_orders.consent_version_id from the exact same
--     server-validated active-version id used to create/update that
--     customer's customer_consents row in the same request (see
--     acceptConsentClickwrap / createNormalBookingCheckout /
--     createPrepaidPackageCheckout) — never two independently-resolved
--     values that could drift apart.
--
-- GAP 1 — Service Terms booking link. consent_version_id did not exist on
-- booking_orders at all. Fix: a nullable FK to consent_versions(id).
-- consent_versions rows are immutable once created (only is_active may
-- ever be updated — see 20260827090000's grants) and are never deleted, so
-- this FK is a safe, permanent, durable pointer to the exact version
-- text presented for this booking — no need to duplicate its body_text
-- onto booking_orders. Dependency ordering is valid: consent_versions is
-- created in 20260827090000, strictly before this migration.
--
-- GAP 2 — Cancellation policy exact wording. cancellation_policy_version
-- (added 20260819130000) is a bare version string; the actual tier
-- text/copy (CANCELLATION_POLICY_TIERS, PREPAID_PACKAGE_CANCELLATION_NOTE)
-- has never been durably versioned in the database the way consent_versions
-- durably versions Service Terms text — it is a plain TypeScript constant.
-- Fix: cancellation_policy_text_snapshot, a nullable text column holding
-- the exact displayed wording (tiers + prepaid note where applicable),
-- frozen verbatim at booking creation, same "freeze the exact text"
-- principle as customer_consents.accepted_text_snapshot and
-- payment_authorization_text_snapshot.
--
-- GAP 3 (documentation only, no column change) — whether
-- payment_authorization_accepted_at can represent the ONE combined
-- acceptance instant. Its existing comment (added 20260819130000) already
-- described a "single combined authorization" covering payment AND
-- cancellation policy; the finalized clickwrap checkbox now additionally
-- covers Service Terms, accepted at the exact same instant in the same
-- request (see acceptConsentClickwrap, called immediately before
-- insertBookingOrder). No new timestamp column is warranted — this one is
-- reused and its comment updated to state its now-fuller scope explicitly,
-- so the DB schema itself (not just application code comments) documents
-- what this timestamp represents.
--
-- Legacy compatibility: both new columns are nullable with no default and
-- no backfill — the 11 pre-existing booking_orders rows, and any row
-- created before this evidence was captured, simply have NULL here,
-- honestly distinguishable from a row with real captured evidence. No
-- historical fact is invented.
--
-- Safety: no DROP/TRUNCATE, no destructive statement, no external
-- call/cron/Stripe/notification side effect — two additive nullable
-- columns, one FK, and a comment update.
-- ============================================================================

alter table public.booking_orders
  add column consent_version_id uuid references public.consent_versions (id);

comment on column public.booking_orders.consent_version_id is
  'Which consent_versions row (Service Terms) was presented and accepted via the combined clickwrap checkbox for THIS booking — the same server-validated active-version id used to create/update the customer''s customer_consents row in the same request (see acceptConsentClickwrap). consent_versions rows are immutable once created (only is_active may ever change), so this is a safe, permanent, durable reference to the exact text shown — no need to duplicate body_text here. Null for booking_orders rows created before this evidence was captured.';

alter table public.booking_orders
  add column cancellation_policy_text_snapshot text;

comment on column public.booking_orders.cancellation_policy_text_snapshot is
  'The exact cancellation/rescheduling/no-access policy wording actually shown to the customer for THIS booking (CANCELLATION_POLICY_TIERS, plus PREPAID_PACKAGE_CANCELLATION_NOTE for a prepaid package — see cancellation-policy.ts), frozen verbatim at booking creation. cancellation_policy_version alone is only a version tag, not durably-versioned text the way consent_versions durably versions Service Terms — this column closes that gap without inventing a parallel versioned-template table for a policy that is a plain application constant. Null for booking_orders rows created before this evidence was captured (the 11 pre-existing production rows, and any other historical row) — never backfilled with invented text.';

comment on column public.booking_orders.payment_authorization_accepted_at is
  'The single instant the customer accepted the ONE combined clickwrap checkbox for this booking, covering Service Terms (see consent_version_id), the disclosed Cancellation/Rescheduling/No-Access fee policy (see cancellation_policy_version and cancellation_policy_text_snapshot), and Payment Authorization (see payment_authorization_text_snapshot) together — not merely payment. Retained under its original name for backward compatibility with existing application code and the pre-existing NOT NULL-for-normal-bookings constraint; its documented scope was already broader than payment alone before this comment update (see 20260819130000''s original comment) and is now made fully explicit. Null only for a prepaid package row (see booking_orders_payment_authorization_required_for_normal) or for rows created before this evidence model existed.';
