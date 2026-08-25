-- ============================================================================
-- Migration: extend service_visit_notifications for Consent + Review V1
-- Consent + Review Automation V1 milestone.
--
-- Purely additive extension of the existing unified notification ledger
-- (see 20260826090000, the Notifications V1 migration) — no second
-- delivery table. Adds three notification_type values: consent_required,
-- consent_reminder, review_request.
--
-- service_visit_id becomes NULLABLE, but only for consent_required: unlike
-- every other notification type, consent is fundamentally customer-level,
-- and a prepaid-package booking has NO real service_visits row yet at the
-- moment payment succeeds (package visit slots start 'planned', not
-- 'linked', until each is individually scheduled later — see
-- activate-prepaid-package-calendar.ts) — so consent_required must be
-- enqueueable with no visit to attach to. consent_reminder stays tied to a
-- specific confirmed visit (that's what "1 day before" means), and
-- review_request stays tied to the specific completed visit — both remain
-- effectively required via the check constraint below, same as every
-- pre-existing type.
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
    'review_request'
  ));

alter table public.service_visit_notifications
  alter column service_visit_id drop not null;

alter table public.service_visit_notifications
  add constraint service_visit_notifications_visit_required_unless_consent_request
  check (service_visit_id is not null or notification_type = 'consent_required');

comment on table public.service_visit_notifications is
  'One row per notification attempt (reminder, event-driven, consent, or review) for a customer, usually scoped to a service_visit. service_visit_id is null only for consent_required (see service_visit_notifications_visit_required_unless_consent_request) — every other type, including consent_reminder and review_request, still requires one. idempotency_key prevents duplicate rows for the same logical notification. state: pending -> sending -> sent, or pending -> sending -> failed -> pending (retry, capped) -> failed (terminal). claimed_at supports safe recovery of a row stuck in ''sending'' after a dispatcher crash — see claim_due_service_visit_notifications().';
