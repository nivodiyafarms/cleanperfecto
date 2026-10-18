-- ============================================================================
-- Migration: widen financial_audit_log.action_type and
-- service_visit_events.event_type for "Revise & Resend Final Total".
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Purely additive: widens both CHECK constraints to also allow a new value,
-- written exactly once per revision start, by start_visit_pricing_revision()
-- (see its own migration). Does not touch any existing row or any other
-- allowed value. Same widening pattern as every prior widening of these two
-- constraints (e.g. 20260914090900_widen_financial_audit_log_action_type_for_invoice_void.sql,
-- 20260921090000_add_work_finished_state_and_finalize_send.sql).
--
-- Dependencies: requires financial_audit_log
-- (20260907090100_create_financial_audit_log.sql) and service_visit_events
-- (20260822091200_create_service_visit_events.sql,
-- 20260921090000_add_work_finished_state_and_finalize_send.sql) to already
-- be applied.
--
-- Safety: no DROP/TRUNCATE, no data mutation — two constraint replacements.
-- ============================================================================

alter table public.financial_audit_log
  drop constraint financial_audit_log_action_type_check;

alter table public.financial_audit_log
  add constraint financial_audit_log_action_type_check
  check (action_type in (
    'external_payment_recorded',
    'fee_waived',
    'refund_issued',
    'financial_correction',
    'tax_override',
    'role_changed',
    'payment_configuration_changed',
    'tax_reversal_reconciled',
    'fee_collected',
    'invoice_voided',
    'custom_charge_added',
    'custom_charge_removed',
    'custom_discount_added',
    'custom_discount_removed',
    'final_total_revision_started'
  ));

alter table public.service_visit_events
  drop constraint service_visit_events_event_type_check;

alter table public.service_visit_events
  add constraint service_visit_events_event_type_check
  check (event_type in (
    'requested', 'confirmed', 'rescheduled', 'reschedule_requested',
    'cleaner_assigned', 'cleaner_reassigned', 'cleaner_unassigned',
    'cancelled', 'completed', 'no_access_recorded',
    'work_finished', 'final_total_sent', 'visit_pricing_revision_started'
  ));
