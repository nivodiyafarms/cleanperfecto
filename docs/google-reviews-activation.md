# Google reviews activation

Production is `numabqpfnigejtdwpxng`. Operational beta Preview is `pitvmtsenkcuapixrilg`. Confirm the target project ref before running anything.

Daily sync and expiry cleanup stay off. The statements under "Deferred: once-daily sync" and "Deferred: independent expiry cleanup" are not part of this release.

## Why this group is not a normal `supabase db push`

Supabase CLI 2.110.0 applies each migration file in its own `BEGIN`/`COMMIT`. `20261024091500_harden_google_reviews_sync_and_retention.sql` calls `cron.schedule('expire-stale-google-reviews', ...)`. `20261031140000_separate_google_reviews_cleanup_schedule_and_harden_sync.sql` unschedules that job. A normal push commits the schedule before the unschedule, so the cleanup job is active between those two commits.

Do not edit those files. Preview has already applied them.

`docs/apply-google-reviews-production.sql` is the production apply. It is not a migration, and `supabase db push` will not run it. It applies `20261024090000` alone, then `20261024091500` and `20261031140000` inside one transaction, then `20261031160000`, `20261031180000`, and `20261031200000` one file per transaction. Each transaction also inserts that file's `version` and `name` into `supabase_migrations.schema_migrations`. The `statements` column is left null. It is nullable on production, and CLI 2.110.0 decides which files are pending from `version` only.

Proven on a throwaway Postgres 16 with pg_cron 1.6, not on production:

- After a per-file commit of `20261024091500`, and before `20261031140000`, another session saw `expire-stale-google-reviews` with `active = true`.
- With the committed script, another session polled 14 times during the open transaction, including a 2 second pause between `cron.schedule` and `cron.unschedule`, and saw 0 rows. After commit the cleanup job was gone.
- Running that script against the throwaway database left `expire-stale-google-reviews` and `sync-google-reviews` absent, recorded all six versions, and left two stand-in jobs named `cleanperfecto-notification-dispatch` and `retry_stuck_webhook_events` with the same job id, schedule, and active flag.
- After those versions were recorded, `supabase db push --dry-run` against that database reported it up to date.

## Production preflight

Read-only check against `numabqpfnigejtdwpxng` on 2026-10-31. `supabase db push --linked --dry-run` would push exactly these files, in this order:

1. `20261024090000_create_google_business_profile_reviews_schema.sql`
2. `20261024091500_harden_google_reviews_sync_and_retention.sql`
3. `20261031140000_separate_google_reviews_cleanup_schedule_and_harden_sync.sql`
4. `20261031160000_fix_google_review_id_regex_for_postgres.sql`
5. `20261031180000_guard_google_reviews_empty_reconciliation.sql`
6. `20261031200000_fix_featured_google_reviews_delete_for_safeupdate.sql`

Latest applied version: `20261019090000`. `cron.job` has two rows, both `active`:

| jobname | schedule |
|---|---|
| `cleanperfecto-notification-dispatch` | `*/5 * * * *` |
| `retry_stuck_webhook_events` | `*/5 * * * *` |

`expire-stale-google-reviews` and `sync-google-reviews` are not scheduled. Repeat the dry-run and the job query immediately before the apply. Stop if the pending filenames, the latest version, or either existing job's name, schedule, or active flag differ. Do not select `command`.

## Production apply

Use a direct or session connection. Do not use the transaction pooler. Do not print the connection string. Do not run `supabase db push` without `--dry-run` for this group.

```text
psql "$PRODUCTION_DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/apply-google-reviews-production.sql
```

The script aborts if either Google reviews job already exists or any of the six versions is already recorded.

After it commits, read job name, schedule, and active flag only. Expect the same two jobs as the preflight, and no Google reviews jobs. A production `supabase db push --linked --dry-run` should then report up to date. Do not run it without `--dry-run`.

## Production release sequence

Do this only under a separate production sign-off. Migrations first, then env, then deploy, then one manual sync. The owner selects reviews after that sync. Daily sync and cleanup stay off.

1. Migrations. Run the preflight, then `docs/apply-google-reviews-production.sql` as above.
2. Env vars, by name, on the production Vercel project. Set values in the dashboard. Do not write them here.
   - `GOOGLE_BUSINESS_PROFILE_CLIENT_ID`
   - `GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET`
   - `GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN`
   - `GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID`
   - `GOOGLE_BUSINESS_PROFILE_LOCATION_ID`
   - `GOOGLE_BUSINESS_PROFILE_LISTING_URL`
   - `CRON_GOOGLE_REVIEWS_SYNC_SECRET`
3. Deploy the approval commit to production. Do not schedule either cron job.
4. One manual sync. `POST /api/cron/sync-google-reviews` with header `x-cron-secret`. `GET` returns 405 and does not sync. Send that request once. Do not insert `sync-google-reviews` into `cron.job`.
5. The owner selects 5 reviews at `/admin/google-reviews`. Do not change user roles.
6. Verification. The homepage shows those reviews. The two existing cron jobs still match the preflight name, schedule, and active flag. `expire-stale-google-reviews` and `sync-google-reviews` are still absent.
7. App rollback. Roll the Vercel production deployment back to the previous production deployment. That leaves the schema in place and does not schedule the cleanup job.
8. DB recovery, only if this migration group itself must be removed. Run the recovery block below on the same direct/session connection. It unschedules `expire-stale-google-reviews` if a row exists, drops the Google reviews objects, and deletes the six history rows. It does not schedule a job and it does not name the other two jobs.

```sql
begin;
select cron.unschedule(jobid)
from cron.job
where jobname = 'expire-stale-google-reviews';

select cron.unschedule(jobid)
from cron.job
where jobname = 'sync-google-reviews';

drop function if exists public.set_featured_google_reviews(jsonb);
drop function if exists public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer, boolean);
drop function if exists public.apply_google_reviews_sync(timestamptz, jsonb, jsonb, numeric, integer);
drop function if exists public.expire_stale_google_reviews();
drop view if exists public.public_featured_google_reviews;
drop view if exists public.public_google_business_profile_rating;
drop table if exists public.featured_google_reviews;
drop table if exists public.google_business_profile_reviews;
drop table if exists public.google_business_profile_sync_state;

delete from supabase_migrations.schema_migrations
where version in (
  '20261024090000',
  '20261024091500',
  '20261031140000',
  '20261031160000',
  '20261031180000',
  '20261031200000'
);
commit;
```

## Deferred: once-daily sync

Do not run the statements below until a later sign-off says recurring sync should start. Preview verification does not include them. These statements are not a substitute for applying the migrations.

The route is POST-only. GET returns 405 and does not sync. Send `x-cron-secret` with `CRON_GOOGLE_REVIEWS_SYNC_SECRET`. Store the URL and secret in Vault for that environment. Do not put the secret in a migration or in this file.

```sql
select vault.create_secret(
  'https://<deployment-host>/api/cron/sync-google-reviews',
  'google_reviews_sync_url',
  'Google reviews sync route for this environment'
);

select vault.create_secret(
  '<CRON_GOOGLE_REVIEWS_SYNC_SECRET>',
  'google_reviews_sync_secret',
  'x-cron-secret for the Google reviews sync route'
);

select cron.schedule(
  'sync-google-reviews',
  '15 13 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'google_reviews_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'google_reviews_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

`15 13 * * *` is 13:15 UTC, once a day. That is 8:15 AM US Central during daylight time and 7:15 AM during standard time.

## Deferred: independent expiry cleanup

This job does not call the app and does not use Google credentials. It deletes cached reviews whose `last_seen_at` is older than 30 days, including when sync is failing. Schedule it only under a later sign-off, after the daily sync, so a successful sync can refresh `last_seen_at` first.

```sql
select cron.schedule(
  'expire-stale-google-reviews',
  '45 13 * * *',
  $$select public.expire_stale_google_reviews();$$
);
```

## Check, without printing secrets

```sql
select jobname, schedule, active
from cron.job
where jobname in (
  'sync-google-reviews',
  'expire-stale-google-reviews',
  'cleanperfecto-notification-dispatch',
  'retry_stuck_webhook_events'
)
order by jobname;
```

Do not select `command`. The deferred statements keep the sync secret in Vault.

To stop either Google reviews job later: `select cron.unschedule(jobid) from cron.job where jobname = '<job-name>';`
