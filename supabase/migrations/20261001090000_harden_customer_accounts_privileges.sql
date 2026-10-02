-- ============================================================================
-- Migration: harden customer_accounts privileges for service_role
--
-- Same schema-level default-grant pattern already found and fixed on
-- financial_audit_log (20260911090000), admin_users (20260912090000),
-- stripe_disputes (20260914090700), prepaid_packages (20260918110000),
-- tax_reversal_reconciliations (20260925100000), and service_visit_payments/
-- service_fee_assessments (20260926090000) — this time on customer_accounts,
-- found during the Production read-only pre-flight for the booking-payment
-- launch: it was the one remaining launch-sensitive table never re-checked
-- against this pattern.
--
-- customer_accounts's own creating migration (20260824100000) granted
-- service_role only SELECT, INSERT, UPDATE. Independently confirmed live
-- against Production (numabqpfnigejtdwpxng): service_role also carries
-- REFERENCES, TRIGGER, and TRUNCATE — privileges this table's migration
-- never explicitly granted, inherited from the same schema-level default
-- privilege set documented on every prior occurrence of this pattern.
-- TRUNCATE is the most material of the three here: customer_accounts is the
-- sole authorization/linking layer between a Supabase Auth identity and a
-- customers row for the entire My CleanPerfecto portal (see
-- require-customer.ts) — a single TRUNCATE would delink every customer's
-- portal access in one statement, with no RLS policy to stand in the way
-- (this table carries the same zero-policy convention as every other table
-- in this schema).
--
-- Confirmed before authoring this migration, by grepping every application
-- code path that touches this table: customer-account-repository.ts reads
-- via .maybeSingle() (findAccountBySupabaseUserId, findAccountByCustomerId)
-- and writes via .insert() (createAccount) only; require-customer.ts reads
-- via .maybeSingle() only. No code path issues an UPDATE or DELETE today,
-- but UPDATE is intentionally retained (matching the creating migration's
-- own grant and its customer_accounts_set_updated_at trigger) for the same
-- reason admin_users keeps UPDATE with no admin-management UI yet authored:
-- future active-flag/role-style toggling. service_role therefore needs
-- exactly SELECT, INSERT, UPDATE — nothing else, matching what this table's
-- own creating migration already (correctly) granted before the
-- schema-level default silently added the rest.
--
-- Purely a privilege change: no table structure, RLS, or RPC change, no
-- data backfill. anon/authenticated already carry zero privileges on this
-- table (verified directly against information_schema.role_table_grants —
-- neither role appears in the grant list at all, consistent with
-- 20260824100000's own `revoke all privileges ... from anon, authenticated`)
-- and are re-revoked explicitly here too, defensively, matching the
-- established convention on every prior migration of this shape.
--
-- Scoped to this table only — this is not a blanket audit of every
-- remaining table's inherited default-privilege grants; that remains a
-- separate, future decision.
-- ============================================================================

revoke truncate, references, trigger
on public.customer_accounts
from service_role;

revoke all privileges
on public.customer_accounts
from anon, authenticated;

grant select, insert, update
on public.customer_accounts
to service_role;
