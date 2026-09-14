-- ============================================================================
-- Migration: widen financial_audit_log.action_type for tax_reversal_reconciled
-- Live-payment hardening milestone — Phase F.1 (durable Tax reversal
-- recovery).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Purely additive: widens the CHECK constraint to also allow
-- 'tax_reversal_reconciled' — written exactly once, atomically, by
-- mark_tax_reversal_reconciliation_succeeded() in
-- 20260914090300_create_tax_reversal_reconciliations.sql, whenever a
-- Stripe Tax reversal (immediate or retried) actually succeeds. Does not
-- touch any existing row or any other allowed value.
--
-- Constraint name is financial_audit_log's original auto-generated name
-- from its inline CHECK in 20260907090100_create_financial_audit_log.sql
-- (financial_audit_log_action_type_check) — known directly since that
-- migration was authored in this same body of work, not discovered
-- dynamically. Same widening pattern already used by
-- 20260907090000_widen_admin_users_role_for_rbac.sql.
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
    'tax_reversal_reconciled'
  ));
