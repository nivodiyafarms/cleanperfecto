-- ============================================================================
-- Migration: add customer_consents.acceptance_method and
--            booking_orders.payment_authorization_text_snapshot
-- Consent Evidence Audit — closes two durable-evidence gaps found while
-- verifying the finalized combined clickwrap booking checkbox.
--
-- AUTHORED ONLY — DO NOT APPLY yet (Group C itself remains unapplied to
-- production; this migration must run strictly after
-- 20260827090300_extend_service_visit_notifications_for_consent_and_review.sql
-- and strictly before 20260828100000, the first Group D migration — a new
-- file, not an edit to any already-rehearsed Group C file).
--
-- GAP 1 — signed_name/state='signed' cannot distinguish HOW acceptance was
-- captured. The original customer_consents design (20260827090100) assumed
-- exactly one acceptance path: a typed legal name (sign-consent.ts). The
-- finalized product decision replaced that, for booking, with a required
-- clickwrap checkbox (accept-consent-clickwrap.ts) that populates
-- signed_name from the customer's own name-of-record (customers.name),
-- never a typed/handwritten signature. sign-consent.ts's typed-name path
-- still exists in the codebase (fully tested) but currently has no live
-- caller — so today every row would in fact be clickwrap-sourced — but the
-- raw persisted data itself carries no field saying so, and nothing
-- prevents a future caller from re-wiring the typed-signature path back in.
-- A column named signed_name with state='signed' is not durable,
-- self-describing evidence of acceptance method on its own; a discovery
-- request, an auditor, or a future engineer reading raw rows years from
-- now must not have to trust "which code existed at the time" to know
-- whether a name was typed or system-populated.
--
-- GAP 2 — booking_orders.payment_authorization_accepted_at is ONLY a
-- timestamp: it proves *that* something was authorized, never *what
-- wording* was shown. Pay Per Cleaning and Prepaid Package display
-- different Payment Authorization copy (SAVED_PAYMENT_AUTHORIZATION_COPY
-- vs PREPAID_PAYMENT_AUTHORIZATION_COPY, both plain TypeScript constants,
-- not a versioned/stored template). If that copy is edited later, there is
-- currently no durable way to reconstruct the exact wording a given
-- historical booking's customer actually saw and accepted.
-- cancellation_policy_version is comparatively fine as bare-version
-- evidence (out of scope for this fix — the audit only asked about payment
-- authorization specifically); payment authorization has no equivalent
-- field at all today, not even a version string.
--
-- Fix, deliberately the smallest durable addition for each gap:
--   customer_consents.acceptance_method — an enum-style text+CHECK column
--     (matches this schema's existing convention), NOT NULL with a default
--     of 'clickwrap' (the only path with a live caller today). Safe as
--     NOT NULL: customer_consents does not exist in production yet (Group
--     C, including this table, is still entirely unapplied), so there is
--     no existing row this could violate.
--   booking_orders.payment_authorization_text_snapshot — a plain nullable
--     text column, the exact frozen payment-authorization copy shown for
--     THAT booking (SAVED_PAYMENT_AUTHORIZATION_COPY or
--     PREPAID_PAYMENT_AUTHORIZATION_COPY, captured verbatim at booking
--     creation) — the same "freeze the exact text, not just a version tag"
--     principle already proven for customer_consents.accepted_text_snapshot.
--     Nullable and left NULL for booking_orders' 11 existing production
--     rows and any other historical row created before this evidence
--     existed — never backfilled with an invented value, so a legacy row
--     stays honestly distinguishable from one with real captured evidence.
--     Not overloading booking_orders.pricing_snapshot: that column's
--     established contract (see create-booking-orders.sql /
--     protect_booking_order_pricing_snapshot()) is specifically the
--     server-authoritative CalculationInput/CalculationResult used for
--     pricing math — authorization-copy evidence is a different concern
--     with a different lifecycle and does not belong inside it.
--
-- Safety: no DROP/TRUNCATE, no destructive statement, no backfill of
-- invented historical facts, both changes additive/nullable-or-defaulted
-- against real existing data.
-- ============================================================================

alter table public.customer_consents
  add column acceptance_method text not null default 'clickwrap'
    check (acceptance_method in ('clickwrap', 'typed_signature'));

comment on column public.customer_consents.acceptance_method is
  'How this acceptance was actually captured — clickwrap: a required checkbox, with signed_name populated from the customer''s own name-of-record (customers.name), never typed by the customer (see accept-consent-clickwrap.ts). typed_signature: the customer typed their own legal name into a dedicated field (see sign-consent.ts) — currently authored but not reachable from any live caller. Exists so raw historical rows are self-describing without depending on which application code existed at the time they were written.';

alter table public.booking_orders
  add column payment_authorization_text_snapshot text;

comment on column public.booking_orders.payment_authorization_text_snapshot is
  'The exact Payment Authorization copy actually shown to the customer for THIS booking at the moment payment_authorization_accepted_at was set — SAVED_PAYMENT_AUTHORIZATION_COPY for a normal booking, PREPAID_PAYMENT_AUTHORIZATION_COPY for a prepaid package (see cancellation-policy.ts) — frozen verbatim, never re-derived from current source at read time. Null for booking_orders rows created before this evidence was captured (the 11 pre-existing production rows, and any other historical row) — deliberately never backfilled with an invented value, so a legacy row stays honestly distinguishable from one with real captured evidence, same principle as cancellation_policy_version being null for pre-existing rows.';
