-- ============================================================================
-- Migration: harden service_visit_payments and service_fee_assessments
-- privileges for service_role
--
-- Same schema-level default-grant pattern already found and fixed on
-- financial_audit_log (20260911090000), admin_users (20260912090000),
-- stripe_disputes (20260914090700), prepaid_packages (20260918110000), and
-- tax_reversal_reconciliations (20260925100000) — this time on the two
-- financial tables the Final Consolidated Regression + Production-Readiness
-- Audit's Part 4 explicitly flagged as still missing the fix:
-- service_visit_payments and service_fee_assessments.
--
-- Both tables' own creating migrations (20260828100300 and 20260822091100
-- respectively) granted service_role only SELECT, INSERT, UPDATE.
-- Independent inspection of the applied Preview grants found service_role
-- also carries REFERENCES, TRIGGER, and TRUNCATE on both — privileges
-- neither table's migration ever explicitly granted, inherited from the
-- same schema-level default privilege set documented on every prior
-- occurrence of this pattern. TRUNCATE is by far the most material of the
-- three on service_visit_payments specifically: this is the single most
-- sensitive financial table in the schema (frozen tip/tax/total facts,
-- refund bookkeeping), and TRUNCATE can erase every row in one statement,
-- bypassing protect_service_visit_payments_financial_facts() entirely (that
-- trigger only guards UPDATE, not TRUNCATE).
--
-- Confirmed before authoring this migration, by grepping every application
-- code path and every RPC body that touches either table (see the Final
-- Pre-Production Database/Security Closure Gate task):
--   - service_visit_payments: read via .select() (supabase-scheduling-
--     repository.ts), written via .insert()/.upsert()/.update() from the
--     same repository, and via UPDATE statements inside
--     refund_visit_payment_with_audit(), record_external_visit_payment_
--     with_audit(), and waive_service_fee_assessment_with_audit() (all
--     SECURITY INVOKER, so they run with the calling service_role client's
--     own privileges — service_role must hold UPDATE directly for these to
--     succeed). No DELETE is issued against this table anywhere.
--   - service_fee_assessments: read via .select() (supabase-scheduling-
--     repository.ts, admin/queries/service-visits.ts, customer-portal/
--     queries.ts), written via .insert() (assessment creation) and via
--     UPDATE statements inside collect_service_fee_assessment_with_audit()
--     and waive_service_fee_assessment_with_audit() (same SECURITY INVOKER
--     reasoning). No DELETE is issued against this table anywhere either.
-- service_role therefore needs exactly SELECT, INSERT, UPDATE on both
-- tables — nothing else, matching what each table's own creating migration
-- already (correctly) granted before the schema-level default silently
-- added the rest.
--
-- Purely a privilege change: no table structure, RLS, or RPC change, no
-- data backfill. anon/authenticated already carry zero privileges on both
-- tables (verified directly against information_schema.role_table_grants —
-- neither role appears in the grant list at all) and are re-revoked
-- explicitly here too, defensively, matching the established convention on
-- every prior migration of this shape.
--
-- Scoped to these two tables only — this is not the blanket audit of every
-- remaining table's inherited default-privilege grants that the readiness
-- audit's Part 4 separately found across the wider schema; that remains a
-- separate, future decision.
-- ============================================================================

revoke truncate, references, trigger
on public.service_visit_payments
from service_role;

revoke all privileges
on public.service_visit_payments
from anon, authenticated;

grant select, insert, update
on public.service_visit_payments
to service_role;

revoke truncate, references, trigger
on public.service_fee_assessments
from service_role;

revoke all privileges
on public.service_fee_assessments
from anon, authenticated;

grant select, insert, update
on public.service_fee_assessments
to service_role;
