-- READ-ONLY. Paste into the production SQL Editor BEFORE applying. Changes nothing.
-- Captures the current definition, owner, SECURITY DEFINER flag, search_path, grants and
-- trigger bindings of every function the referral migration touches or depends on, so we can
-- compare production -> proposed and restore if needed. The referral migration replaces NO
-- existing function; protect_service_visit_payments_financial_facts and set_updated_at are
-- captured because the migration adds triggers next to / using them. Referral names should
-- return no rows (they must not exist yet).

select p.oid::regprocedure as function_signature,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proconfig as config_search_path,
  p.proacl as grants,
  (select string_agg(t.tgrelid::regclass || '.' || t.tgname, ', ' order by t.tgname)
     from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal) as trigger_bindings,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('protect_service_visit_payments_financial_facts','set_updated_at',
                    'current_customer_id','current_admin_is_owner','attribute_referral','clear_referral_credit_when_payment_resets','consume_referral_redemption','create_admin_referral_code','create_customer_referral_code','flag_shared_payment_method','preview_referral_credit','protect_referral_credit_amount','referral_current_admin_is_owner','referral_current_customer_id','referral_pricing_facts','referral_visit_is_eligible','reserve_referral_credit','restore_referral_redemption','reverse_referral_for_visit','set_referral_code_active','sync_referral_qualification')
order by 1;

select t.tgname, pg_get_triggerdef(t.oid) as trigger_def
from pg_trigger t
where t.tgrelid = to_regclass('public.service_visit_payments') and not t.tgisinternal
order by t.tgname;

select version, name from supabase_migrations.schema_migrations order by version desc limit 10;
