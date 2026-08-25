-- ============================================================================
-- Migration: widen service_visit_notifications for Payments V1
-- Pay-Per-Cleaning Charge & Payment Completion V1 milestone.
--
-- Purely additive extension of the existing unified notification ledger
-- (see 20260826090000, 20260827090300) — no second delivery table, no
-- structural change. Adds three notification_type values:
-- payment_succeeded, payment_failed, payment_action_required.
--
-- All three always have a real, already-completed service_visit (payment
-- only ever happens post-completion) — no nullable-service_visit_id
-- exception is needed for them, unlike consent_required. The existing
-- service_visit_notifications_visit_required_unless_consent_request
-- constraint already requires a non-null service_visit_id for anything
-- other than consent_required, so these three types automatically inherit
-- "visit required" with zero further constraint changes.
--
-- pricing_approval_required already exists and is reused unchanged for the
-- "price increase needs your approval" notification — not duplicated here.
-- ============================================================================

alter table public.service_visit_notifications
  drop constraint service_visit_notifications_notification_type_check;

alter table public.service_visit_notifications
  add constraint service_visit_notifications_notification_type_check
  check (notification_type in (
    'reminder_24h',
    'appointment_confirmed',
    'rescheduled',
    'cancelled',
    'completed',
    'pricing_approval_required',
    'consent_required',
    'consent_reminder',
    'review_request',
    'payment_succeeded',
    'payment_failed',
    'payment_action_required'
  ));

comment on table public.service_visit_notifications is
  'One row per notification attempt (reminder, event-driven, consent, review, or payment) for a customer, usually scoped to a service_visit. service_visit_id is null only for consent_required (see service_visit_notifications_visit_required_unless_consent_request) — every other type, including the payment_* types, still requires one. idempotency_key prevents duplicate rows for the same logical notification. state: pending -> sending -> sent, or pending -> sending -> failed -> pending (retry, capped) -> failed (terminal). claimed_at supports safe recovery of a row stuck in ''sending'' after a dispatcher crash — see claim_due_service_visit_notifications().';
