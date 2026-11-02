-- READ-ONLY precheck for production numabqpfnigejtdwpxng. Changes nothing.
-- Expect: first query ok=true on every row. Anything false = STOP, do not run the apply script.

select 'latest migration is exactly 20261031200000' as check_name,
  (select max(version) from supabase_migrations.schema_migrations) = '20261031200000' as ok
union all
select 'protect_service_visit_payments_financial_facts() exists',
  to_regprocedure('public.protect_service_visit_payments_financial_facts()') is not null
union all
select 'set_updated_at() exists', to_regprocedure('public.set_updated_at()') is not null
union all
select 'service_visit_payments table exists', to_regclass('public.service_visit_payments') is not null
union all
select 'payments financial-facts trigger bound',
  exists (select 1 from pg_trigger where tgrelid = to_regclass('public.service_visit_payments')
          and tgname = 'service_visit_payments_protect_financial_facts' and not tgisinternal)
union all
select 'no referral function names exist yet',
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('attribute_referral','clear_referral_credit_when_payment_resets','consume_referral_redemption','create_admin_referral_code','create_customer_referral_code','flag_shared_payment_method','preview_referral_credit','protect_referral_credit_amount','referral_current_admin_is_owner','referral_current_customer_id','referral_pricing_facts','referral_visit_is_eligible','reserve_referral_credit','restore_referral_redemption','reverse_referral_for_visit','set_referral_code_active','sync_referral_qualification'))
union all
select 'no referral tables exist yet',
  not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace
              and relname in ('referral_codes','referrals','referral_credits','referral_redemptions','referral_program_audit'))
union all
select 'service_visit_payments.referral_credit_amount column not yet present',
  not exists (select 1 from information_schema.columns where table_schema='public'
              and table_name='service_visit_payments' and column_name='referral_credit_amount');

select version, name from supabase_migrations.schema_migrations order by version desc limit 3;
