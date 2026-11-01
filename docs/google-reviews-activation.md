# Google reviews activation

Apply these files together, in order: `20261024090000`, `20261024091500`, `20261031140000`, `20261031160000`, `20261031180000`, and `20261031200000`. `20261031160000` replaces the review-id check. Postgres rejects the earlier `{1,512}` repeat, and a sync against that version aborts before it writes. `20261031180000` drops that five-argument function and requires an explicit confirmation argument before an empty fetched-id list can delete cached reviews. `20261031200000` rewrites `set_featured_google_reviews()` so its deletes use `WHERE true`. pg-safeupdate rejects a bare `DELETE` (SQLSTATE 21000, `DELETE requires a WHERE clause`) when PostgREST calls the function. Migrations install `expire_stale_google_reviews()`, `apply_google_reviews_sync()`, and `set_featured_google_reviews()`. They do not leave a recurring job scheduled. `20261031140000_separate_google_reviews_cleanup_schedule_and_harden_sync.sql` removes `expire-stale-google-reviews` if an older migration created it. `20261031180000` and `20261031200000` do not schedule or unschedule any job.

Do not run the statements below until that environment should actually start recurring work. Preview verification does not include them. Production needs a separate sign-off, and these statements are not a substitute for applying the migrations.

Confirm the target project ref before running anything. Production is `numabqpfnigejtdwpxng`. Operational beta Preview is `pitvmtsenkcuapixrilg`.

## Once-daily sync

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

## Independent expiry cleanup

This job does not call the app and does not use Google credentials. It deletes cached reviews whose `last_seen_at` is older than 30 days, including when sync is failing. Schedule it after the daily sync so a successful sync can refresh `last_seen_at` first.

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
where jobname in ('sync-google-reviews', 'expire-stale-google-reviews');
```

Do not select `command` if a job was created with a secret embedded in the SQL. The statements above keep the secret in Vault.

To stop either job later: `select cron.unschedule(jobid) from cron.job where jobname = '<job-name>';`
