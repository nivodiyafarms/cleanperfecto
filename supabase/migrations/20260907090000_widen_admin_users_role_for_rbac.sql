-- ============================================================================
-- Migration: widen admin_users.role for owner_admin / operations RBAC
-- Phase 2 — Production Safety, Environment Controls, RBAC, and Financial
-- Auditability.
--
-- AUTHORED ONLY — DO NOT APPLY. Rehearsed and reviewed in Phase 3 against a
-- disposable project first; the real production admin_users rows have not
-- yet been inspected (see the transition strategy below).
--
-- Purely additive: widens the CHECK constraint to also allow 'owner_admin'
-- and 'operations' alongside the existing 'admin'. Deliberately does NOT:
--   - change the column default (stays 'admin' — this schema has no
--     self-signup path; every admin_users row is still hand-provisioned via
--     the Supabase dashboard, per the original migration's own comment)
--   - backfill/update any existing row's role
--   - drop the 'admin' value from the allowed set
--
-- Transition strategy (explicit, per Phase 2 instructions):
--   'admin' is a LEGACY value, not a role Phase 2 application code ever
--   assigns to a new row. Application code (see
--   src/lib/admin/rbac/capabilities.ts) treats an existing 'admin' row as
--   OWNER-EQUIVALENT for the duration of this transition, so no currently-
--   working admin access breaks the moment this migration is applied.
--   Phase 3 will inspect the real production admin_users rows before any
--   decision is made to migrate them to 'owner_admin' explicitly or to
--   retire the 'admin' value outright — that backfill/cleanup is
--   deliberately NOT part of this migration.
--
-- Constraint name is the table's original auto-generated name from its
-- inline CHECK in 20260823100000_create_admin_users.sql
-- (admin_users_role_check) — known directly since that migration was
-- authored in this same body of work, not discovered dynamically.
--
-- Dependencies: requires 20260823100000_create_admin_users.sql to already
-- be applied (it creates the table and the constraint this migration
-- widens). No other migration depends on this one.
--
-- Safety: no DROP/TRUNCATE, no data mutation, no cron/trigger/side effect —
-- a single constraint replacement.
-- ============================================================================

alter table public.admin_users
  drop constraint admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('admin', 'owner_admin', 'operations'));

comment on column public.admin_users.role is
  'Phase 2 RBAC: owner_admin (all capabilities, privileged financial actions) or operations (routine operational actions only — see src/lib/admin/rbac/capabilities.ts for the exact split). ''admin'' is a LEGACY value from the pre-RBAC V1 milestone, treated as owner-equivalent by application code during the transition — never assigned to a new row. Phase 3 decides the eventual backfill/cleanup of existing ''admin'' rows after inspecting real production data. Still hand-provisioned only, via the Supabase dashboard — no self-signup UI exists or is planned.';
