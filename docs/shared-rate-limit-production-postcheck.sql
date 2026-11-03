-- READ-ONLY postcheck for production numabqpfnigejtdwpxng. Changes nothing.
-- Run this after docs/apply-shared-rate-limit-production-sql-editor.sql.
-- The last result is the checklist. Every ok value must be true.

select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

-- checklist
select 'latest migration is exactly 20261103120000' as check_name,
  (select max(version) from supabase_migrations.schema_migrations) = '20261103120000' as ok
union all
select 'schema_migrations records add_shared_rate_limit',
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261103120000' and name = 'add_shared_rate_limit'
  )
union all
select 'rate_limit_buckets table exists',
  to_regclass('public.rate_limit_buckets') is not null
union all
select 'rate_limit_buckets has row level security',
  coalesce((
    select c.relrowsecurity
    from pg_class c
    where c.oid = to_regclass('public.rate_limit_buckets')
  ), false)
union all
select 'rate_limit_buckets has no policies',
  to_regclass('public.rate_limit_buckets') is not null
  and not exists (
    select 1 from pg_policy
    where polrelid = to_regclass('public.rate_limit_buckets')
  )
union all
select 'rate_limit_buckets columns are only key/window/count (no raw IP column)',
  coalesce((
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rate_limit_buckets'
  ), array[]::text[])
  = array['key', 'window_seconds', 'window_start', 'count']::text[]
union all
select 'anon has no rate_limit_buckets privileges',
  coalesce((
    select not has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'insert')
      and not has_table_privilege('anon', c.oid, 'update')
      and not has_table_privilege('anon', c.oid, 'delete')
    from pg_class c
    where c.oid = to_regclass('public.rate_limit_buckets')
  ), false)
union all
select 'authenticated has no rate_limit_buckets privileges',
  coalesce((
    select not has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert')
      and not has_table_privilege('authenticated', c.oid, 'update')
      and not has_table_privilege('authenticated', c.oid, 'delete')
    from pg_class c
    where c.oid = to_regclass('public.rate_limit_buckets')
  ), false)
union all
select 'anon cannot execute consume_rate_limits',
  coalesce((
    select not has_function_privilege('anon', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.consume_rate_limits(text, integer, integer)')
  ), false)
union all
select 'authenticated cannot execute consume_rate_limits',
  coalesce((
    select not has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.consume_rate_limits(text, integer, integer)')
  ), false)
union all
select 'consume_rate_limits is security definer with fixed empty search_path',
  coalesce((
    select p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg = 'search_path=' or cfg = 'search_path=""'
      )
    from pg_proc p
    where p.oid = to_regprocedure('public.consume_rate_limits(text, integer, integer)')
  ), false)
union all
select 'service_role can execute consume_rate_limits',
  coalesce((
    select has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.consume_rate_limits(text, integer, integer)')
  ), false);
