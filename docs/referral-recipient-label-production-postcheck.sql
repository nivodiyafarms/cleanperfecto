-- READ-ONLY postcheck for production numabqpfnigejtdwpxng. Changes nothing.
-- Run this after docs/apply-referral-recipient-label-production-sql-editor.sql.
-- The last result is the checklist. Every ok value must be true.

select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

-- checklist
select 'latest migration is exactly 20261102120000' as check_name,
  (select max(version) from supabase_migrations.schema_migrations) = '20261102120000' as ok
union all
select 'schema_migrations records add_referral_code_recipient_label',
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261102120000' and name = 'add_referral_code_recipient_label'
  )
union all
select 'recipient label table exists', to_regclass('public.referral_code_recipient_labels') is not null
union all
select 'recipient label table has row level security',
  coalesce((
    select c.relrowsecurity
    from pg_class c
    where c.oid = to_regclass('public.referral_code_recipient_labels')
  ), false)
union all
select 'recipient label table has no policies',
  to_regclass('public.referral_code_recipient_labels') is not null
  and not exists (
    select 1 from pg_policy
    where polrelid = to_regclass('public.referral_code_recipient_labels')
  )
union all
select 'referral_codes has no recipient_label column',
  to_regclass('public.referral_codes') is not null
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_codes' and column_name = 'recipient_label'
  )
union all
select 'anon cannot select recipient labels',
  coalesce((
    select not has_table_privilege('anon', c.oid, 'select')
    from pg_class c
    where c.oid = to_regclass('public.referral_code_recipient_labels')
  ), false)
union all
select 'authenticated cannot select recipient labels',
  coalesce((
    select not has_table_privilege('authenticated', c.oid, 'select')
    from pg_class c
    where c.oid = to_regclass('public.referral_code_recipient_labels')
  ), false)
union all
select 'authenticated cannot insert recipient labels',
  coalesce((
    select not has_table_privilege('authenticated', c.oid, 'insert')
    from pg_class c
    where c.oid = to_regclass('public.referral_code_recipient_labels')
  ), false)
union all
select 'authenticated cannot change recipient labels',
  coalesce((
    select not has_table_privilege('authenticated', c.oid, 'update')
      and not has_table_privilege('authenticated', c.oid, 'delete')
    from pg_class c
    where c.oid = to_regclass('public.referral_code_recipient_labels')
  ), false)
union all
select 'service_role can read and write recipient labels but not remove rows',
  coalesce((
    select has_table_privilege('service_role', c.oid, 'select')
      and has_table_privilege('service_role', c.oid, 'insert')
      and has_table_privilege('service_role', c.oid, 'update')
      and not has_table_privilege('service_role', c.oid, 'delete')
    from pg_class c
    where c.oid = to_regclass('public.referral_code_recipient_labels')
  ), false)
union all
select 'audit stores previous_value and new_value',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_program_audit' and column_name = 'previous_value'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_program_audit' and column_name = 'new_value'
  )
union all
select 'audit action check allows recipient_label_updated',
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.referral_program_audit')
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recipient_label_updated%'
  )
union all
select 'recipient label enforcement trigger is bound',
  exists (
    select 1 from pg_trigger
    where tgname = 'referral_code_recipient_labels_enforce'
      and tgrelid = to_regclass('public.referral_code_recipient_labels')
      and not tgisinternal
  )
union all
select 'create_admin_referral_code(uuid, text) is still the original function',
  coalesce((
    select pg_get_functiondef(p.oid) not like '%recipient_label%'
    from pg_proc p
    where p.oid = to_regprocedure('public.create_admin_referral_code(uuid, text)')
  ), false)
union all
select 'create_admin_referral_code_with_label is definer, fixed search_path, service_role only',
  coalesce((
    select p.prosecdef
      and 'search_path=public' = any (p.proconfig)
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.create_admin_referral_code_with_label(uuid, text, text)')
  ), false)
union all
select 'update_admin_referral_code_recipient_label is definer, fixed search_path, service_role only',
  coalesce((
    select p.prosecdef
      and 'search_path=public' = any (p.proconfig)
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.update_admin_referral_code_recipient_label(uuid, uuid, text)')
  ), false)
union all
select 'label helper functions are not executable by anon or authenticated',
  coalesce((
    select not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.normalize_referral_recipient_label(text)')
  ), false)
  and coalesce((
    select not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p
    where p.oid = to_regprocedure('public.enforce_referral_code_recipient_label()')
  ), false)
union all
select 'label change function records recipient_label_updated and leaves program rows alone',
  coalesce((
    select pg_get_functiondef(p.oid) like '%recipient_label_updated%'
      and pg_get_functiondef(p.oid) like '%RECIPIENT_LABEL_TYPE_A_REJECTED%'
      and pg_get_functiondef(p.oid) not like '%update public.referral_codes%'
      and pg_get_functiondef(p.oid) not like '%update public.referrals%'
      and pg_get_functiondef(p.oid) not like '%referral_credits%'
      and pg_get_functiondef(p.oid) not like '%referral_redemptions%'
    from pg_proc p
    where p.oid = to_regprocedure('public.update_admin_referral_code_recipient_label(uuid, uuid, text)')
  ), false);
