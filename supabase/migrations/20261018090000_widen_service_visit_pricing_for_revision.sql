-- ============================================================================
-- Migration: widen service_visit_pricing for the "Revise & Resend Final
-- Total" feature.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Problem: once a visit completes, three independent layers (two app-level
-- guards plus the BEFORE UPDATE trigger on this table) permanently freeze
-- its pricing. There is no existing path to correct an already-sent, unpaid
-- Final Total. The approved fix (owner-reviewed, corrected twice before
-- landing on this design) does NOT revert service_visits.status back to
-- work_finished — the cleaning itself stays a completed historical fact.
-- Instead, a narrower, durable "pricing revision" window is introduced,
-- scoped to just this table and service_visit_payments.
--
-- This migration adds the two durable facts that window needs:
--   - 'revision_in_progress' as a new price_status value — inserted between
--     'confirmed' and a later re-'confirmed', set only by the
--     start_visit_pricing_revision RPC (see its own migration) and cleared
--     by the existing confirmVisitPricing() path.
--   - revision_number integer, a monotonic counter (0 = never revised, the
--     original Finalize & Send). This is the stable "which revision"
--     identifier sendFinalTotalReadyImmediately keys its resend-dedup on —
--     amount alone is not a safe proxy, since a scope change can leave the
--     total unchanged, or a later revision can return to a previously-sent
--     amount.
--
-- Dependencies: requires service_visit_pricing
-- (20260824100400_create_service_visit_pricing.sql) to already be applied.
--
-- Safety: no DROP/TRUNCATE, no data mutation beyond the new column's
-- default backfill (0 for every existing row, which is exactly correct —
-- no pre-existing row has ever been through a revision).
-- ============================================================================

alter table public.service_visit_pricing
  add column revision_number integer not null default 0;

comment on column public.service_visit_pricing.revision_number is
  'Monotonic counter, incremented only by start_visit_pricing_revision(). 0 = never revised (the original Finalize & Send, true for every pre-existing row). The stable identifier sendFinalTotalReadyImmediately keys its resend-dedup idempotency key on once >= 1 — see its own doc comment for why amount alone is not a safe proxy.';

alter table public.service_visit_pricing
  drop constraint service_visit_pricing_price_status_check;

alter table public.service_visit_pricing
  add constraint service_visit_pricing_price_status_check
  check (price_status in ('estimated', 'pending_customer_approval', 'confirmed', 'revision_in_progress'));
