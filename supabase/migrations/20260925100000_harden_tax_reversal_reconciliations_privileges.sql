-- ============================================================================
-- Migration: harden tax_reversal_reconciliations privileges for service_role
-- Same schema-level default-grant pattern already found and fixed on
-- financial_audit_log (20260911090000), admin_users (20260912090000),
-- stripe_disputes (20260914090700), and prepaid_packages (20260918110000).
--
-- Found during the Final Consolidated Regression + Production-Readiness
-- Audit (Part 2, migration promotion review): unlike every other new
-- financial table added since 20260911090000, this table's own creating
-- migration (20260914090300_create_tax_reversal_reconciliations.sql) did
-- NOT include the `revoke truncate, references, trigger` line — an
-- oversight, not a deliberate choice (its own header comment references
-- the "same freeze-trigger convention" as service_visit_payments but never
-- mentions privileges). Independently confirmed against Preview
-- (pitvmtsenkcuapixrilg): service_role carries REFERENCES, TRIGGER, and
-- TRUNCATE on this table, none of which its creating migration explicitly
-- granted. TRUNCATE is the most material of the three here: it can erase
-- every durable Tax-reversal recovery record in one statement — exactly
-- the failure mode this table exists to prevent (a lost reversal-retry
-- record reintroduces the permanent accounting mismatch Phase F.1 was
-- built to fix).
--
-- Confirmed before authoring this migration: the table's only writers
-- (create_tax_reversal_reconciliation, mark_tax_reversal_reconciliation_succeeded,
-- mark_tax_reversal_reconciliation_failed — all in this table's own
-- creating migration) only ever SELECT/INSERT/UPDATE; none issues a
-- TRUNCATE, and no DELETE grant was ever given (matching the table's own
-- "a reconciliation record is never removed" comment). service_role needs
-- exactly SELECT, INSERT, UPDATE — nothing else.
--
-- Purely a privilege change: no table structure, RLS, or RPC change, no
-- data backfill. anon/authenticated are re-revoked explicitly here too,
-- defensively, even though they were already revoked by 20260914090300
-- and no migration since has touched them.
--
-- Scoped to this table only — this is not a blanket audit of every
-- table's inherited default-privilege grants; that remains a separate,
-- future decision.
-- ============================================================================

revoke truncate, references, trigger
on public.tax_reversal_reconciliations
from service_role;

revoke all privileges
on public.tax_reversal_reconciliations
from anon, authenticated;

grant select, insert, update
on public.tax_reversal_reconciliations
to service_role;
