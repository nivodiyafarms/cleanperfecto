-- READ-ONLY precheck for production numabqpfnigejtdwpxng. Changes nothing.
-- Run this before docs/apply-shared-rate-limit-production-sql-editor.sql.
-- The last result is the checklist. Every ok value must be true. Any false means stop.

select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

-- checklist
select 'latest migration is exactly 20261102120000' as check_name,
  (select max(version) from supabase_migrations.schema_migrations) = '20261102120000' as ok
union all
select 'rate_limit_buckets table does not exist yet',
  to_regclass('public.rate_limit_buckets') is null
union all
select 'consume_rate_limits does not exist yet',
  to_regprocedure('public.consume_rate_limits(text, integer, integer)') is null;
