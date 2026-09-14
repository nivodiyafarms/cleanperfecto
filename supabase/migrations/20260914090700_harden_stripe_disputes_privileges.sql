-- ============================================================================
-- Migration: harden stripe_disputes privileges for service_role
-- Phase C follow-up — same schema-level default-grant pattern already found
-- and fixed on financial_audit_log (20260911090000) and admin_users
-- (20260912090000).
--
-- stripe_disputes's creating migration (20260914090600) granted service_role
-- only SELECT, INSERT, UPDATE. Independent inspection of the applied
-- preview grants found service_role also carries REFERENCES, TRIGGER, and
-- TRUNCATE — privileges this table's migration never explicitly granted,
-- inherited from the same schema-level default privilege set documented on
-- the two prior tables. TRUNCATE is the most material of the three here: it
-- can erase every persisted dispute fact in one statement, bypassing the
-- monotonic/causal guard upsert_stripe_dispute_event() otherwise enforces.
--
-- Purely a privilege change: no table structure, RLS, or RPC change, no
-- data backfill. service_role still needs exactly SELECT (read dispute
-- state), INSERT and UPDATE (upsert_stripe_dispute_event, SECURITY DEFINER-
-- equivalent via service_role's own privileges) — nothing else. anon/
-- authenticated are re-revoked explicitly here too, defensively, even
-- though they were already revoked by 20260914090600 and no migration
-- since has touched them.
--
-- Scoped to this table only — this is not a blanket audit of every table's
-- inherited default-privilege grants; that is a separate, future decision.
-- ============================================================================

revoke truncate, references, trigger
on public.stripe_disputes
from service_role;

revoke all privileges
on public.stripe_disputes
from anon, authenticated;

grant select, insert, update
on public.stripe_disputes
to service_role;
