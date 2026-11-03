-- ============================================================================
-- Migration: shared Supabase-backed rate limit buckets
--
-- AUTHORED ONLY. Do not apply to production (numabqpfnigejtdwpxng).
-- Preview only after an explicit sign-off.
--
-- Fixed-window counters shared across every app instance. The sole caller
-- today is the public quote-page referral-code check, which stores only an
-- HMAC key (never a raw IP). RLS is on with no policies; anon and
-- authenticated have no privileges. service_role is the only granted role
-- and is what the server-side consume RPC uses.
-- Existing functions are not replaced.
-- ============================================================================

create table public.rate_limit_buckets (
  key text not null,
  window_seconds integer not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (key, window_seconds, window_start),
  constraint rate_limit_buckets_key_check check (
    char_length(key) between 1 and 200
  ),
  constraint rate_limit_buckets_window_seconds_check check (
    window_seconds > 0
    and window_seconds <= 86400
  ),
  constraint rate_limit_buckets_count_check check (
    count >= 0
  )
);

comment on table public.rate_limit_buckets is
  'Fixed-window rate-limit counters. Keys are opaque HMAC digests (never raw IPs). Written only by consume_rate_limits.';

comment on column public.rate_limit_buckets.key is
  'Opaque bucket key (e.g. referral_check:<hex HMAC>). Never a raw client IP.';

comment on column public.rate_limit_buckets.window_seconds is
  'Fixed window length in seconds (60 for minute, 3600 for hour).';

comment on column public.rate_limit_buckets.window_start is
  'Inclusive start of the fixed window (UTC), aligned to epoch / window_seconds.';

comment on column public.rate_limit_buckets.count is
  'Attempts recorded in this window, capped at limit+1 by consume_rate_limits.';

alter table public.rate_limit_buckets enable row level security;

revoke all on public.rate_limit_buckets from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

create function public.consume_rate_limits(
  p_key text,
  p_minute_limit integer default 5,
  p_hour_limit integer default 20
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_epoch double precision;
  v_minute_start timestamptz;
  v_hour_start timestamptz;
  v_minute_count integer;
  v_hour_count integer;
  v_minute_blocked boolean;
  v_hour_blocked boolean;
  v_retry integer := 0;
  v_minute_retry integer;
  v_hour_retry integer;
begin
  if p_key is null
     or pg_catalog.char_length(p_key) < 1
     or pg_catalog.char_length(p_key) > 200
     or p_key !~ '^referral_check:' then
    raise exception 'RATE_LIMIT_INVALID_KEY';
  end if;

  if p_minute_limit is null
     or p_minute_limit < 1
     or p_minute_limit > 1000 then
    raise exception 'RATE_LIMIT_INVALID_MINUTE_LIMIT';
  end if;

  if p_hour_limit is null
     or p_hour_limit < 1
     or p_hour_limit > 10000 then
    raise exception 'RATE_LIMIT_INVALID_HOUR_LIMIT';
  end if;

  v_now := pg_catalog.now();
  v_epoch := pg_catalog.extract(epoch from v_now);
  v_minute_start := pg_catalog.to_timestamp(
    pg_catalog.floor(v_epoch / 60::double precision) * 60::double precision
  );
  v_hour_start := pg_catalog.to_timestamp(
    pg_catalog.floor(v_epoch / 3600::double precision) * 3600::double precision
  );

  insert into public.rate_limit_buckets as b (key, window_seconds, window_start, count)
  values (p_key, 60, v_minute_start, 1)
  on conflict (key, window_seconds, window_start)
  do update set count = pg_catalog.least(b.count + 1, p_minute_limit + 1)
  returning b.count into v_minute_count;

  insert into public.rate_limit_buckets as b (key, window_seconds, window_start, count)
  values (p_key, 3600, v_hour_start, 1)
  on conflict (key, window_seconds, window_start)
  do update set count = pg_catalog.least(b.count + 1, p_hour_limit + 1)
  returning b.count into v_hour_count;

  v_minute_blocked := v_minute_count > p_minute_limit;
  v_hour_blocked := v_hour_count > p_hour_limit;

  if not v_minute_blocked and not v_hour_blocked then
    allowed := true;
    retry_after_seconds := 0;
    return next;
    return;
  end if;

  if v_minute_blocked then
    v_minute_retry := pg_catalog.greatest(
      0,
      pg_catalog.ceil(
        pg_catalog.extract(
          epoch from (v_minute_start + pg_catalog.make_interval(secs => 60) - v_now)
        )
      )::integer
    );
    v_retry := v_minute_retry;
  end if;

  if v_hour_blocked then
    v_hour_retry := pg_catalog.greatest(
      0,
      pg_catalog.ceil(
        pg_catalog.extract(
          epoch from (v_hour_start + pg_catalog.make_interval(secs => 3600) - v_now)
        )
      )::integer
    );
    if v_hour_retry > v_retry then
      v_retry := v_hour_retry;
    end if;
  end if;

  allowed := false;
  retry_after_seconds := v_retry;
  return next;
end;
$$;

revoke all on function public.consume_rate_limits(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limits(text, integer, integer) to service_role;

comment on function public.consume_rate_limits(text, integer, integer) is
  'Atomically consumes the 60s and 3600s fixed windows for a key. Counters stop at limit+1. allowed only when both windows are within limit. retry_after_seconds is seconds until the latest blocking window ends (0 when allowed). service_role only.';
