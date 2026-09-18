-- ============================================================================
-- Migration: harden prepaid_packages privileges for service_role
-- Same schema-level default-grant pattern already found and fixed on
-- financial_audit_log (20260911090000), admin_users (20260912090000), and
-- stripe_disputes (20260914090700).
--
-- prepaid_packages's creating migration (20260818120500) granted service_role
-- only SELECT, INSERT, UPDATE, and explicitly noted "No delete grant —
-- cancellation is a status, not a deletion." Independent inspection of the
-- applied preview grants found service_role also carries REFERENCES,
-- TRIGGER, and TRUNCATE — privileges this table's migration never explicitly
-- granted, inherited from the same schema-level default privilege set
-- documented on the three prior tables. TRUNCATE is the most material of the
-- three here: it can erase every prepaid package's financial state
-- (package_total_paid, tax_amount, total_amount_paid, refunded_amount) in
-- one statement.
--
-- Confirmed before authoring this migration: no application code path
-- (booking repository, scheduling repository, admin queries, customer-portal
-- queries, or cancel_prepaid_package_with_refund_audit()) issues a DELETE
-- against prepaid_packages — cancellation is exclusively a status update.
-- service_role needs exactly SELECT (reads), INSERT
-- (activatePrepaidPackage), and UPDATE (cancel_prepaid_package_with_refund_
-- audit(), which runs as the invoking role, not SECURITY DEFINER) — nothing
-- else.
--
-- Purely a privilege change: no table structure, RLS, or RPC change, no
-- data backfill, no change to package business logic or tax accounting.
-- anon/authenticated are re-revoked explicitly here too, defensively, even
-- though they were already revoked by 20260818120500 and no migration since
-- has touched them.
--
-- Scoped to this table only — this is not a blanket audit of every table's
-- inherited default-privilege grants; that is a separate, future decision.
-- ============================================================================

revoke truncate, references, trigger
on public.prepaid_packages
from service_role;

revoke all privileges
on public.prepaid_packages
from anon, authenticated;

grant select, insert, update
on public.prepaid_packages
to service_role;
