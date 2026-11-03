-- ============================================================================
-- Daily cleanup for public.rate_limit_buckets via pg_cron.
--
-- NOT applied automatically. Owner approval required before scheduling.
-- Do not put this in supabase/migrations. Do not modify any existing
-- cron jobs (notification dispatch, webhook retry, google reviews, etc.).
--
-- Deletes fixed-window rows older than 2 days. Safe to re-run: cron.schedule
-- with a unique job name fails if the name already exists — unschedule first
-- only under a separate, explicit sign-off if you need to replace it.
-- ============================================================================

-- Preview / inspect only (read-only):
-- select jobid, jobname, schedule, active from cron.job
-- where jobname = 'cleanup-rate-limit-buckets';

select cron.schedule(
  'cleanup-rate-limit-buckets',
  '20 14 * * *',
  $$delete from public.rate_limit_buckets where window_start < now() - interval '2 days';$$
);
