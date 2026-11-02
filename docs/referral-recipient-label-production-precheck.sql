-- READ-ONLY precheck for production numabqpfnigejtdwpxng. Changes nothing.
-- Run this before docs/apply-referral-recipient-label-production-sql-editor.sql.
-- The last result is the checklist. Every ok value must be true. Any false means stop.

select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

-- checklist
select 'latest migration is exactly 20261101120000' as check_name,
  (select max(version) from supabase_migrations.schema_migrations) = '20261101120000' as ok
union all
select 'referral_codes table exists', to_regclass('public.referral_codes') is not null
union all
select 'referral_program_audit table exists', to_regclass('public.referral_program_audit') is not null
union all
select 'create_admin_referral_code(uuid, text) exists',
  to_regprocedure('public.create_admin_referral_code(uuid, text)') is not null
union all
select 'set_updated_at() exists', to_regprocedure('public.set_updated_at()') is not null
union all
select 'referral_code_recipient_labels table does not exist yet',
  to_regclass('public.referral_code_recipient_labels') is null
union all
select 'referral_codes.recipient_label column does not exist yet',
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_codes' and column_name = 'recipient_label'
  )
union all
select 'audit previous_value column does not exist yet',
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_program_audit' and column_name = 'previous_value'
  )
union all
select 'audit new_value column does not exist yet',
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_program_audit' and column_name = 'new_value'
  )
union all
select 'create_admin_referral_code_with_label does not exist yet',
  to_regprocedure('public.create_admin_referral_code_with_label(uuid, text, text)') is null
union all
select 'update_admin_referral_code_recipient_label does not exist yet',
  to_regprocedure('public.update_admin_referral_code_recipient_label(uuid, uuid, text)') is null
union all
select 'normalize_referral_recipient_label does not exist yet',
  to_regprocedure('public.normalize_referral_recipient_label(text)') is null
union all
select 'enforce_referral_code_recipient_label does not exist yet',
  to_regprocedure('public.enforce_referral_code_recipient_label()') is null;
