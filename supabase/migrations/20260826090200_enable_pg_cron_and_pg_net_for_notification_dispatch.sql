-- ============================================================================
-- Migration: enable pg_cron and pg_net (Supabase Cron foundation)
-- Notifications V1 milestone.
--
-- Enables the two extensions Supabase Cron needs (pg_cron to schedule,
-- pg_net to make the outbound HTTP call to our Next.js dispatch route) —
-- and nothing else. This migration does NOT schedule any job. Scheduling
-- the actual 5-minute job is a deliberately MANUAL, later step (run once
-- per environment via the Supabase SQL editor, after the two required
-- Vault secrets exist) because:
--   - the dispatch route's URL differs per environment (local/disposable/
--     staging/production) and must never be hardcoded into a committed,
--     auto-applied migration
--   - the shared dispatch secret must never be committed in cleartext
--   - "do not point a real recurring cron job at production yet" is an
--     explicit constraint of this milestone
--
-- See the Notifications V1 architecture report for the exact manual
-- cron.schedule(...) statement to run later, once Vault secrets
-- 'notification_dispatch_url' and 'notification_dispatch_secret' exist.
--
-- If this project's plan/permissions don't allow `create extension` for
-- pg_cron/pg_net via SQL migration, enable them manually first via
-- Supabase Dashboard -> Database -> Extensions, then this migration
-- becomes a safe no-op on reapply (create extension if not exists).
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
