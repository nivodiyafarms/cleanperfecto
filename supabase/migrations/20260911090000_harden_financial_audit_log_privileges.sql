-- ============================================================================
-- Migration: harden financial_audit_log privileges for service_role
-- Phase 2 follow-up — post-Group-E security hardening.
--
-- financial_audit_log's creating migration (20260907090100) granted
-- service_role only SELECT and INSERT, intending a genuinely append-only
-- ledger. Independent inspection of the applied production grants found
-- service_role also carries REFERENCES, TRIGGER, and TRUNCATE — privileges
-- this table's migration never explicitly granted, evidently inherited
-- from a schema-level default privilege set applied to every table in
-- this project. TRUNCATE in particular defeats the append-only intent
-- outright: it can erase the entire audit ledger in one statement,
-- bypassing every row-level protection this schema otherwise relies on.
--
-- Purely a privilege change: no table structure, RLS, or RPC change, no
-- data backfill. service_role still needs exactly SELECT (read the trail)
-- and INSERT (the two Group E *_with_audit RPCs, both SECURITY INVOKER,
-- write through service_role's own privileges) — nothing else. anon/
-- authenticated are re-revoked explicitly here too, defensively, even
-- though they were already revoked by 20260907090100 and no migration
-- since has touched them.
--
-- Scoped to this table only — this is not a blanket audit of every table's
-- inherited default-privilege grants; that is a separate, future decision.
-- ============================================================================

revoke update, delete, truncate, references, trigger
on public.financial_audit_log
from service_role;

revoke all privileges
on public.financial_audit_log
from anon, authenticated;

grant select, insert
on public.financial_audit_log
to service_role;
