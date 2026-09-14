-- ============================================================================
-- Migration: widen financial_audit_log.action_type for invoice_voided
-- Live-payment hardening milestone — Phase I (invoice/receipt documents).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Purely additive: widens the CHECK constraint to also allow
-- 'invoice_voided' — written exactly once per void, atomically, by
-- void_invoice_with_audit() in
-- 20260914090800_create_invoice_receipt_documents.sql. Does not touch any
-- existing row or any other allowed value. issue_invoice()/issue_receipt()
-- themselves never write an audit row (system-driven fact recording at
-- settlement time, no admin actor — same precedent already established for
-- upsert_stripe_dispute_event()); only the admin-triggered void action
-- needs one.
--
-- Same widening pattern as 20260914090400_widen_financial_audit_log_action_type_for_tax_reversal.sql
-- and 20260914090500_add_service_fee_assessment_collection_and_rpc.sql.
--
-- Dependencies: requires financial_audit_log
-- (20260907090100_create_financial_audit_log.sql) to already be applied.
--
-- Safety: no DROP/TRUNCATE, no data mutation — a single constraint
-- replacement.
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
    'invoice_voided'
  ));
