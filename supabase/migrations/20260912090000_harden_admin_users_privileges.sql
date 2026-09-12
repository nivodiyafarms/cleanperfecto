-- ============================================================================
-- Migration: harden admin_users privileges for service_role
-- Least-privilege follow-up, same pattern as
-- 20260911090000_harden_financial_audit_log_privileges.sql.
--
-- admin_users's creating migration (20260823100000) never explicitly
-- granted service_role anything — it inherited SELECT, INSERT, UPDATE,
-- REFERENCES, TRIGGER, and TRUNCATE from this project's schema-level
-- default privilege set. DELETE was already absent. The only application
-- code path that touches this table today is the read-only lookup in
-- findActiveAdminUserBySupabaseUserId (src/lib/admin/require-admin.ts) —
-- no admin-creation or role-management UI is authored yet (see
-- capabilities.ts's reserved manage_roles capability) — but SELECT,
-- INSERT, and UPDATE are all legitimately needed for the near-term
-- admin-provisioning and active/role-toggling operations this table
-- exists for. REFERENCES and TRIGGER serve no operational purpose for
-- service_role, and TRUNCATE is the same category of risk closed on
-- financial_audit_log: one statement that could erase every admin row,
-- including the very row protecting the schema, bypassing row-level
-- logic entirely.
--
-- Purely a privilege change: no table structure, RLS, or authorization-
-- logic change, no data backfill, no admin row created.
-- ============================================================================

revoke delete, truncate, references, trigger
on public.admin_users
from service_role;

revoke all privileges
on public.admin_users
from anon, authenticated;

grant select, insert, update
on public.admin_users
to service_role;
