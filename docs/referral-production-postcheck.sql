-- READ-ONLY postcheck for production numabqpfnigejtdwpxng. Expect: latest version 20261101120000,
-- all 5 tables present=true and rls_enabled=true, every definer function shows anon_exec=false
-- (authenticated_exec=true only for functions the app calls as a signed-in user, e.g.
-- create_customer_referral_code / preview_referral_credit; compare with Preview), and
-- auth_insert=false, auth_update=false on referral_codes.

select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

select t.tbl, c.oid is not null as present, coalesce(c.relrowsecurity,false) as rls_enabled
from unnest(array['referral_codes','referrals','referral_credits','referral_redemptions','referral_program_audit']) t(tbl)
left join pg_class c on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace;

select p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and (p.proname like '%referral%' or p.proname in ('flag_shared_payment_method'))
order by 1;

select
  has_table_privilege('authenticated','public.referral_codes','insert') as auth_insert,
  has_table_privilege('authenticated','public.referral_codes','update') as auth_update
where to_regclass('public.referral_codes') is not null;
-- Shared payments guard must be unchanged (still the 20261018090200 body, no referral_credit_amount),
-- and the separate referral guard trigger must be bound. Expect: false, true.
select pg_get_functiondef('public.protect_service_visit_payments_financial_facts()'::regprocedure) like '%referral_credit_amount%' as shared_fn_modified,
  exists (select 1 from pg_trigger where tgname='service_visit_payments_protect_referral_credit_amount'
          and tgrelid='public.service_visit_payments'::regclass) as referral_guard_bound;
