-- ============================================================================
-- Migration: referral program (codes, attribution, credits, redemptions)
--
-- AUTHORED ONLY. Do not apply to production (numabqpfnigejtdwpxng).
-- Preview (pitvmtsenkcuapixrilg) only after an explicit sign-off.
--
-- Financial inserts and status changes for credits, redemptions, and
-- referral codes run inside the security-definer functions below.
-- authenticated can read its own rows and has no insert/update/delete
-- grant on these tables. Code issue and enable/disable go through the
-- service_role functions, which write the owner audit row. service_role
-- bypasses RLS and is the only role that may execute the functions.
-- ============================================================================

alter table public.quote_requests
  add column referral_code text;

comment on column public.quote_requests.referral_code is
  'Normalized referral code captured with the quote. Null when the customer did not enter one. Pricing columns are unchanged.';

alter table public.agreed_quote_invitations
  add column referral_code text;

comment on column public.agreed_quote_invitations.referral_code is
  'Referral code carried onto an agreed-quote invitation. Null when none was entered.';

alter table public.booking_orders
  add column referral_code_id uuid,
  add column referral_id uuid;

alter table public.service_visit_payments
  add column referral_credit_amount numeric(10, 2) not null default 0;

comment on column public.service_visit_payments.referral_credit_amount is
  'Referral credit reserved for this payment, subtracted from the taxable service amount before tax. 0 when no credit applies. Not part of the pricing-engine total.';

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  code_type text not null check (code_type in ('customer', 'admin_issued')),
  referrer_customer_id uuid references public.customers (id),
  issued_by_admin_user_id uuid references public.admin_users (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_shape check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  constraint referral_codes_type_owner check (
    (code_type = 'customer' and referrer_customer_id is not null)
    or (code_type = 'admin_issued' and referrer_customer_id is null and issued_by_admin_user_id is not null)
  )
);

create unique index referral_codes_one_per_customer_idx
  on public.referral_codes (referrer_customer_id)
  where code_type = 'customer';

comment on table public.referral_codes is
  'One reusable random code per customer, or an owner-issued code with no customer account. Codes contain no name, email, phone, or address.';

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes (id),
  referred_customer_id uuid not null unique references public.customers (id),
  household_key text,
  qualifying_service_visit_id uuid unique references public.service_visits (id),
  quote_request_id uuid references public.quote_requests (id),
  agreed_quote_invitation_id uuid references public.agreed_quote_invitations (id),
  booking_order_id uuid references public.booking_orders (id),
  status text not null default 'attributed' check (status in ('attributed', 'credited', 'review', 'rejected')),
  review_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index referrals_household_key_idx
  on public.referrals (household_key)
  where household_key is not null;

comment on table public.referrals is
  'One referral per referred customer and household. qualifying_service_visit_id is the friend''s first visit. review_flags holds shared_address and shared_payment for owner review.';

alter table public.booking_orders
  add constraint booking_orders_referral_code_id_fkey foreign key (referral_code_id) references public.referral_codes (id),
  add constraint booking_orders_referral_id_fkey foreign key (referral_id) references public.referrals (id);

create table public.referral_credits (
  id uuid primary key default gen_random_uuid(),
  beneficiary_customer_id uuid not null references public.customers (id),
  referral_id uuid not null references public.referrals (id),
  beneficiary_role text not null check (beneficiary_role in ('friend', 'referrer')),
  amount numeric(10, 2) not null default 15 check (amount = 15),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check (status in ('available', 'reserved', 'redeemed', 'expired', 'voided', 'review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, beneficiary_role)
);

comment on table public.referral_credits is
  '$15 issued once per beneficiary role for a referral. Expires 60 days after issued_at. Referrer rows are omitted when the rolling 12-month cap is already full.';

create table public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  referral_credit_id uuid not null references public.referral_credits (id),
  service_visit_id uuid not null references public.service_visits (id),
  service_visit_payment_id uuid references public.service_visit_payments (id),
  amount numeric(10, 2) not null check (amount = 15),
  eligible_cleaning_amount numeric(10, 2) not null,
  status text not null check (status in ('reserved', 'consumed', 'restored', 'voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index referral_redemptions_one_active_per_credit_idx
  on public.referral_redemptions (referral_credit_id)
  where status in ('reserved', 'consumed');

create unique index referral_redemptions_one_active_per_visit_idx
  on public.referral_redemptions (service_visit_id)
  where status in ('reserved', 'consumed');

comment on table public.referral_redemptions is
  'Links one credit to one visit. reserved becomes consumed when the visit is fully paid, restored on cancel without changing the credit expiry, or voided when the credit is voided.';

create table public.referral_program_audit (
  id uuid primary key default gen_random_uuid(),
  actor_admin_user_id uuid not null references public.admin_users (id),
  action_type text not null check (action_type in ('code_issued', 'code_disabled', 'code_enabled')),
  target_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.referral_program_audit is
  'Owner audit trail for issuing and disabling referral codes. Credit issuance and redemption are recorded on their own tables, not rewritten here.';

create trigger referral_codes_set_updated_at
before update on public.referral_codes
for each row execute function public.set_updated_at();

create trigger referrals_set_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

create trigger referral_credits_set_updated_at
before update on public.referral_credits
for each row execute function public.set_updated_at();

create trigger referral_redemptions_set_updated_at
before update on public.referral_redemptions
for each row execute function public.set_updated_at();

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id
  from public.customer_accounts
  where supabase_user_id = auth.uid()
    and active = true
$$;

create or replace function public.current_admin_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where supabase_user_id = auth.uid()
      and active = true
      and role in ('owner_admin', 'admin')
  )
$$;

revoke all on function public.current_customer_id() from public, anon;
revoke all on function public.current_admin_is_owner() from public, anon;
grant execute on function public.current_customer_id() to authenticated, service_role;
grant execute on function public.current_admin_is_owner() to authenticated, service_role;

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_credits enable row level security;
alter table public.referral_redemptions enable row level security;
alter table public.referral_program_audit enable row level security;

revoke all on public.referral_codes, public.referrals, public.referral_credits, public.referral_redemptions, public.referral_program_audit
from anon, authenticated;

grant select on public.referral_codes, public.referrals, public.referral_credits, public.referral_redemptions
to authenticated;

grant select on public.referral_program_audit to authenticated;

grant select, insert, update on public.referral_codes, public.referrals, public.referral_credits, public.referral_redemptions, public.referral_program_audit
to service_role;

create policy referral_codes_select on public.referral_codes
for select to authenticated
using (
  referrer_customer_id = public.current_customer_id()
  or public.current_admin_is_owner()
);

create policy referrals_select on public.referrals
for select to authenticated
using (
  public.current_admin_is_owner()
  or referred_customer_id = public.current_customer_id()
  or exists (
    select 1 from public.referral_codes
    where referral_codes.id = referrals.referral_code_id
      and referral_codes.referrer_customer_id = public.current_customer_id()
  )
);

create policy referral_credits_select on public.referral_credits
for select to authenticated
using (
  beneficiary_customer_id = public.current_customer_id()
  or public.current_admin_is_owner()
);

create policy referral_redemptions_select on public.referral_redemptions
for select to authenticated
using (
  public.current_admin_is_owner()
  or exists (
    select 1 from public.referral_credits
    where referral_credits.id = referral_redemptions.referral_credit_id
      and referral_credits.beneficiary_customer_id = public.current_customer_id()
  )
);

create policy referral_program_audit_select on public.referral_program_audit
for select to authenticated
using (public.current_admin_is_owner());

create or replace function public.create_customer_referral_code(p_customer_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.referral_codes;
  v_row public.referral_codes;
begin
  select * into v_existing
  from public.referral_codes
  where code_type = 'customer' and referrer_customer_id = p_customer_id
  for update;

  if v_existing.id is not null then
    return jsonb_build_object('code', v_existing.code, 'id', v_existing.id);
  end if;

  insert into public.referral_codes (code, code_type, referrer_customer_id)
  values (p_code, 'customer', p_customer_id)
  returning * into v_row;

  return jsonb_build_object('code', v_row.code, 'id', v_row.id);
exception when unique_violation then
  select * into v_existing
  from public.referral_codes
  where code_type = 'customer' and referrer_customer_id = p_customer_id;
  if v_existing.id is not null then
    return jsonb_build_object('code', v_existing.code, 'id', v_existing.id);
  end if;
  raise exception 'REFERRAL_CODE_COLLISION';
end;
$$;

create or replace function public.create_admin_referral_code(p_admin_user_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.referral_codes;
begin
  insert into public.referral_codes (code, code_type, issued_by_admin_user_id)
  values (p_code, 'admin_issued', p_admin_user_id)
  returning * into v_row;

  insert into public.referral_program_audit (actor_admin_user_id, action_type, target_id)
  values (p_admin_user_id, 'code_issued', v_row.id);

  return jsonb_build_object('code', v_row.code, 'id', v_row.id);
exception when unique_violation then
  raise exception 'REFERRAL_CODE_COLLISION';
end;
$$;

create or replace function public.set_referral_code_active(
  p_code_id uuid,
  p_active boolean,
  p_admin_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.referral_codes set active = p_active where id = p_code_id;
  if not found then
    raise exception 'UNKNOWN_CODE';
  end if;
  insert into public.referral_program_audit (actor_admin_user_id, action_type, target_id, reason)
  values (p_admin_user_id, case when p_active then 'code_enabled' else 'code_disabled' end, p_code_id, p_reason);
end;
$$;

create or replace function public.attribute_referral(
  p_code text,
  p_friend_customer_id uuid,
  p_friend_email text,
  p_friend_phone text,
  p_household_key text,
  p_friend_has_completed_service boolean,
  p_friend_payment_method_id text,
  p_quote_request_id uuid,
  p_agreed_quote_invitation_id uuid,
  p_booking_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.referral_codes;
  v_referrer public.customers;
  v_existing public.referrals;
  v_flags text[] := '{}';
  v_referral public.referrals;
begin
  select * into v_code from public.referral_codes where code = p_code for update;
  if v_code.id is null then
    return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_CODE');
  end if;
  if v_code.active is not true then
    return jsonb_build_object('ok', false, 'reason', 'INACTIVE_CODE');
  end if;

  if v_code.referrer_customer_id is not null then
    select * into v_referrer from public.customers where id = v_code.referrer_customer_id;
    if v_code.referrer_customer_id = p_friend_customer_id
      or (v_referrer.email_normalized is not null and v_referrer.email_normalized = p_friend_email)
      or (v_referrer.phone_normalized is not null and v_referrer.phone_normalized = p_friend_phone)
    then
      return jsonb_build_object('ok', false, 'reason', 'SELF_REFERRAL');
    end if;
  end if;

  select * into v_existing from public.referrals where referred_customer_id = p_friend_customer_id for update;
  if v_existing.id is not null then
    if v_existing.referral_code_id = v_code.id then
      return jsonb_build_object('ok', true, 'referralId', v_existing.id, 'referralCodeId', v_code.id, 'flags', v_existing.review_flags);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'NOT_NEW_CUSTOMER');
  end if;

  if p_friend_has_completed_service
    or exists (select 1 from public.service_visits where customer_id = p_friend_customer_id and status = 'completed')
    or (p_household_key is not null and exists (select 1 from public.referrals where household_key = p_household_key))
  then
    return jsonb_build_object('ok', false, 'reason', 'NOT_NEW_CUSTOMER');
  end if;

  if p_household_key is not null and v_code.referrer_customer_id is not null and (
    exists (
      select 1 from public.service_visits
      where customer_id = v_code.referrer_customer_id and service_address_identity = p_household_key
    )
    or exists (
      select 1 from public.quote_requests
      where customer_id = v_code.referrer_customer_id and service_address_identity = p_household_key
    )
  ) then
    v_flags := array_append(v_flags, 'shared_address');
  end if;

  if v_code.referrer_customer_id is not null
    and p_friend_payment_method_id is not null
    and v_referrer.stripe_default_payment_method_id is not null
    and p_friend_payment_method_id = v_referrer.stripe_default_payment_method_id
  then
    v_flags := array_append(v_flags, 'shared_payment');
  end if;

  insert into public.referrals (
    referral_code_id, referred_customer_id, household_key, quote_request_id,
    agreed_quote_invitation_id, booking_order_id, status, review_flags
  ) values (
    v_code.id, p_friend_customer_id, p_household_key, p_quote_request_id,
    p_agreed_quote_invitation_id, p_booking_order_id,
    case when cardinality(v_flags) > 0 then 'review' else 'attributed' end,
    v_flags
  ) returning * into v_referral;

  return jsonb_build_object('ok', true, 'referralId', v_referral.id, 'referralCodeId', v_code.id, 'flags', v_flags);
end;
$$;

create or replace function public.sync_referral_qualification(p_service_visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.service_visits;
  v_pricing public.service_visit_pricing;
  v_payment public.service_visit_payments;
  v_package public.prepaid_packages;
  v_referral public.referrals;
  v_code public.referral_codes;
  v_prior integer;
  v_fully_paid boolean := false;
  v_referrer_count integer;
  v_referrer_lock_id uuid;
  v_issued_at timestamptz := now();
  v_expires_at timestamptz := now() + interval '60 days';
  v_ids jsonb := '[]'::jsonb;
  v_existing_count integer;
begin
  select * into v_visit from public.service_visits where id = p_service_visit_id for update;
  if v_visit.id is null then
    return jsonb_build_object('issuedCreditIds', '[]'::jsonb);
  end if;

  select * into v_referral from public.referrals where referred_customer_id = v_visit.customer_id for update;
  if v_referral.id is null or v_referral.status = 'rejected' then
    return jsonb_build_object('issuedCreditIds', '[]'::jsonb);
  end if;

  select count(*) into v_prior
  from public.service_visits
  where customer_id = v_visit.customer_id and status = 'completed' and id <> v_visit.id;

  if v_referral.qualifying_service_visit_id is null then
    if v_prior > 0 then
      return jsonb_build_object('issuedCreditIds', '[]'::jsonb);
    end if;
    update public.referrals set qualifying_service_visit_id = v_visit.id where id = v_referral.id;
    v_referral.qualifying_service_visit_id := v_visit.id;
  end if;

  if v_referral.qualifying_service_visit_id is distinct from v_visit.id then
    return jsonb_build_object('issuedCreditIds', '[]'::jsonb);
  end if;

  select * into v_pricing from public.service_visit_pricing where service_visit_id = v_visit.id;
  select * into v_payment from public.service_visit_payments where service_visit_id = v_visit.id order by created_at desc limit 1;
  if v_visit.prepaid_package_id is not null then
    select * into v_package from public.prepaid_packages where id = v_visit.prepaid_package_id;
  end if;

  if v_payment.status = 'paid' or v_pricing.payment_status = 'paid' then
    v_fully_paid := true;
  elsif coalesce(v_pricing.amount_due_from_customer, 0) > 0 then
    v_fully_paid := false;
  elsif v_visit.prepaid_package_id is not null and v_package.status is distinct from 'cancelled'
    and (v_pricing.payment_status is null or v_pricing.payment_status in ('not_applicable', 'paid'))
  then
    v_fully_paid := true;
  end if;

  if v_visit.status is distinct from 'completed' or v_fully_paid is not true then
    return jsonb_build_object('issuedCreditIds', '[]'::jsonb);
  end if;

  select count(*) into v_existing_count from public.referral_credits where referral_id = v_referral.id;
  if v_existing_count > 0 then
    return jsonb_build_object(
      'issuedCreditIds',
      coalesce((select jsonb_agg(id) from public.referral_credits where referral_id = v_referral.id), '[]'::jsonb)
    );
  end if;

  select * into v_code from public.referral_codes where id = v_referral.referral_code_id for update;

  insert into public.referral_credits (
    beneficiary_customer_id, referral_id, beneficiary_role, amount, issued_at, expires_at, status
  ) values (
    v_referral.referred_customer_id, v_referral.id, 'friend', 15, v_issued_at, v_expires_at, 'available'
  );

  if v_code.code_type = 'customer' and v_code.referrer_customer_id is not null then
    -- Lock the referrer customer row before the cap count. Locking existing
    -- credit rows does not cover a concurrent insert, and locks nothing
    -- when the referrer has no credit row yet.
    select id into v_referrer_lock_id
    from public.customers
    where id = v_code.referrer_customer_id
    for update;
    if v_referrer_lock_id is null then
      perform pg_advisory_xact_lock(hashtextextended('referral_referrer_cap:' || v_code.referrer_customer_id::text, 0));
    end if;

    select count(*) into v_referrer_count
    from public.referral_credits
    where beneficiary_customer_id = v_code.referrer_customer_id
      and beneficiary_role = 'referrer'
      and status <> 'voided'
      and issued_at > now() - interval '12 months';

    if v_referrer_count < 5 then
      insert into public.referral_credits (
        beneficiary_customer_id, referral_id, beneficiary_role, amount, issued_at, expires_at, status
      ) values (
        v_code.referrer_customer_id, v_referral.id, 'referrer', 15, v_issued_at, v_expires_at, 'available'
      );
    end if;
  end if;

  update public.referrals
  set status = case when cardinality(review_flags) > 0 then 'review' else 'credited' end
  where id = v_referral.id;

  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids
  from public.referral_credits
  where referral_id = v_referral.id;

  return jsonb_build_object('issuedCreditIds', v_ids);
end;
$$;

-- Resolves the cleaning price that counts toward $150, and whether another
-- promotion already applies. base_amount is the customer booking price and
-- can include travel, supplies, add-ons, and customization, so it is used
-- only when the visit has no calculation result. Add-on, custom-charge,
-- tax, and tip columns are never added in.
create or replace function public.referral_pricing_facts(p_service_visit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visit public.service_visits;
  v_pricing public.service_visit_pricing;
  v_snapshot jsonb;
  v_result jsonb;
  v_scope_id uuid;
  v_cleaning numeric;
  v_special numeric;
  v_core numeric;
  v_recurring numeric;
  v_eligible numeric;
  v_program text;
  v_stacking boolean := false;
  v_adjustment jsonb;
begin
  select * into v_visit from public.service_visits where id = p_service_visit_id;
  select * into v_pricing from public.service_visit_pricing where service_visit_id = p_service_visit_id;
  if v_pricing.id is null then
    return jsonb_build_object('eligibleCleaningAmount', 0, 'stackingBlocked', false);
  end if;

  v_snapshot := v_pricing.pricing_snapshot;
  if jsonb_typeof(v_snapshot) = 'object' then
    if jsonb_typeof(v_snapshot->'result') = 'object' and (v_snapshot->'result') ? 'cleaningSubtotal' then
      v_result := v_snapshot->'result';
    elsif jsonb_typeof(v_snapshot->'bookingOrderPricingSnapshot') = 'object'
      and jsonb_typeof(v_snapshot->'bookingOrderPricingSnapshot'->'result') = 'object'
      and (v_snapshot->'bookingOrderPricingSnapshot'->'result') ? 'cleaningSubtotal' then
      v_result := v_snapshot->'bookingOrderPricingSnapshot'->'result';
    elsif v_snapshot ? 'cleaningSubtotal' and v_snapshot ? 'basePrice' then
      v_result := v_snapshot;
    elsif v_snapshot ? 'recurringScopeVersionId'
      and (v_snapshot->>'recurringScopeVersionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_scope_id := (v_snapshot->>'recurringScopeVersionId')::uuid;
      select case
        when jsonb_typeof(pricing_snapshot->'result') = 'object'
          and (pricing_snapshot->'result') ? 'cleaningSubtotal' then pricing_snapshot->'result'
        when pricing_snapshot ? 'cleaningSubtotal' and pricing_snapshot ? 'basePrice' then pricing_snapshot
        else null
      end
      into v_result
      from public.recurring_scope_versions
      where id = v_scope_id;
    end if;
  end if;

  if v_result is null and v_visit.booking_order_id is not null then
    select case
      when jsonb_typeof(pricing_snapshot->'result') = 'object'
        and (pricing_snapshot->'result') ? 'cleaningSubtotal' then pricing_snapshot->'result'
      else null
    end
    into v_result
    from public.booking_orders
    where id = v_visit.booking_order_id;
  end if;

  if v_visit.prepaid_package_id is not null or coalesce(v_pricing.custom_discount_amount, 0) > 0 then
    v_stacking := true;
  end if;
  if jsonb_typeof(v_pricing.custom_adjustments) = 'array' then
    for v_adjustment in
      select value from jsonb_array_elements(v_pricing.custom_adjustments)
    loop
      if v_adjustment->>'type' = 'custom_discount' and coalesce((v_adjustment->>'amount')::numeric, 0) > 0 then
        v_stacking := true;
      end if;
    end loop;
  end if;

  if v_result is not null then
    v_program := coalesce(v_result->>'discountProgram', '');
    if v_program in ('first_cleaning', 'prepaid_package')
      or coalesce((v_result->>'firstCleaningDiscount')::numeric, 0) > 0
      or coalesce((v_result->>'packageDiscount')::numeric, 0) > 0
      or (
        jsonb_typeof(v_result->'prepaidPackageTotal') = 'number'
        and coalesce((v_result->>'prepaidPackageTotal')::numeric, 0) > 0
      )
    then
      v_stacking := true;
    end if;

    v_cleaning := coalesce((v_result->>'cleaningSubtotal')::numeric, 0);
    v_special := coalesce((v_result->>'specialRoomChargesTotal')::numeric, 0)
      * coalesce((v_result->>'squareFootageMultiplier')::numeric, 1)
      * coalesce((v_result->>'conditionMultiplier')::numeric, 1);
    v_core := v_cleaning - v_special;
    v_recurring := coalesce((v_result->>'recurringAdjustment')::numeric, 0);
    if v_program = 'recurring_cycle'
      and v_cleaning > 0
      and v_recurring > 0
      and coalesce((v_result->>'firstCleaningDiscount')::numeric, 0) = 0
      and coalesce((v_result->>'packageDiscount')::numeric, 0) = 0
    then
      v_eligible := v_core * (1 - (v_recurring / v_cleaning));
    else
      v_eligible := v_core;
    end if;
    if v_eligible < 0 then
      v_eligible := 0;
    end if;
    v_eligible := round(v_eligible, 2);
  else
    v_eligible := round(coalesce(v_pricing.base_amount, 0), 2);
  end if;

  return jsonb_build_object(
    'eligibleCleaningAmount', v_eligible,
    'stackingBlocked', v_stacking
  );
end;
$$;

create or replace function public.referral_visit_is_eligible(
  p_service_visit_id uuid,
  p_role text,
  p_qualifying_visit_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visit public.service_visits;
  v_pricing public.service_visit_pricing;
  v_prior integer;
  v_facts jsonb;
begin
  select * into v_visit from public.service_visits where id = p_service_visit_id;
  select * into v_pricing from public.service_visit_pricing where service_visit_id = p_service_visit_id;
  if v_visit.id is null or v_pricing.id is null then
    return false;
  end if;

  v_facts := public.referral_pricing_facts(p_service_visit_id);
  if coalesce((v_facts->>'stackingBlocked')::boolean, false) then
    return false;
  end if;
  if coalesce((v_facts->>'eligibleCleaningAmount')::numeric, 0) < 150 then
    return false;
  end if;
  if p_role = 'friend' then
    if p_qualifying_visit_id is not null and p_qualifying_visit_id = p_service_visit_id then
      return false;
    end if;
    select count(*) into v_prior
    from public.service_visits
    where customer_id = v_visit.customer_id and status = 'completed' and id <> p_service_visit_id;
    if v_prior < 1 then
      return false;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.reserve_referral_credit(p_service_visit_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.service_visits;
  v_facts jsonb;
  v_credit public.referral_credits;
  v_referral public.referrals;
  v_existing public.referral_redemptions;
begin
  select * into v_visit from public.service_visits where id = p_service_visit_id for update;
  if v_visit.id is null then
    return 0;
  end if;

  update public.referral_credits
  set status = 'expired'
  where beneficiary_customer_id = v_visit.customer_id
    and status in ('available', 'reserved')
    and expires_at <= now();

  select * into v_existing
  from public.referral_redemptions
  where service_visit_id = p_service_visit_id and status in ('reserved', 'consumed')
  for update;
  if v_existing.id is not null then
    return v_existing.amount;
  end if;

  v_facts := public.referral_pricing_facts(p_service_visit_id);

  for v_credit in
    select * from public.referral_credits
    where beneficiary_customer_id = v_visit.customer_id and status = 'available'
    order by expires_at
    for update
  loop
    select * into v_referral from public.referrals where id = v_credit.referral_id;
    if public.referral_visit_is_eligible(p_service_visit_id, v_credit.beneficiary_role, v_referral.qualifying_service_visit_id) then
      update public.referral_credits set status = 'reserved' where id = v_credit.id;
      insert into public.referral_redemptions (
        referral_credit_id, service_visit_id, amount, eligible_cleaning_amount, status
      ) values (
        v_credit.id, p_service_visit_id, 15, coalesce((v_facts->>'eligibleCleaningAmount')::numeric, 0), 'reserved'
      );
      return 15;
    end if;
  end loop;

  return 0;
end;
$$;

create or replace function public.preview_referral_credit(p_service_visit_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visit public.service_visits;
  v_credit public.referral_credits;
  v_referral public.referrals;
  v_existing public.referral_redemptions;
begin
  select * into v_visit from public.service_visits where id = p_service_visit_id;
  if v_visit.id is null then
    return 0;
  end if;
  select * into v_existing
  from public.referral_redemptions
  where service_visit_id = p_service_visit_id and status in ('reserved', 'consumed')
  limit 1;
  if v_existing.id is not null then
    return v_existing.amount;
  end if;
  for v_credit in
    select * from public.referral_credits
    where beneficiary_customer_id = v_visit.customer_id
      and status = 'available'
      and expires_at > now()
    order by expires_at
  loop
    select * into v_referral from public.referrals where id = v_credit.referral_id;
    if public.referral_visit_is_eligible(p_service_visit_id, v_credit.beneficiary_role, v_referral.qualifying_service_visit_id) then
      return 15;
    end if;
  end loop;
  return 0;
end;
$$;

create or replace function public.consume_referral_redemption(p_service_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.referral_redemptions;
begin
  select * into v_redemption
  from public.referral_redemptions
  where service_visit_id = p_service_visit_id and status = 'reserved'
  for update;
  if v_redemption.id is null then
    return;
  end if;
  update public.referral_redemptions set status = 'consumed' where id = v_redemption.id;
  update public.referral_credits set status = 'redeemed'
  where id = v_redemption.referral_credit_id and status = 'reserved';
end;
$$;

create or replace function public.restore_referral_redemption(p_service_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.referral_redemptions;
  v_credit public.referral_credits;
begin
  select * into v_redemption
  from public.referral_redemptions
  where service_visit_id = p_service_visit_id and status in ('reserved', 'consumed')
  for update;
  if v_redemption.id is null then
    return;
  end if;
  update public.referral_redemptions set status = 'restored' where id = v_redemption.id;
  select * into v_credit from public.referral_credits where id = v_redemption.referral_credit_id for update;
  if v_credit.status in ('voided', 'review') then
    return;
  end if;
  update public.referral_credits
  set status = case when expires_at <= now() then 'expired' else 'available' end
  where id = v_credit.id;
end;
$$;

create or replace function public.reverse_referral_for_visit(p_service_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral public.referrals;
  v_credit public.referral_credits;
  v_used public.referral_redemptions;
begin
  select * into v_referral from public.referrals where qualifying_service_visit_id = p_service_visit_id for update;
  if v_referral.id is not null then
    for v_credit in select * from public.referral_credits where referral_id = v_referral.id for update loop
      if v_credit.status in ('redeemed', 'review') then
        update public.referral_credits set status = 'review' where id = v_credit.id;
      elsif v_credit.status in ('available', 'reserved', 'expired') then
        update public.referral_credits set status = 'voided' where id = v_credit.id;
        update public.referral_redemptions
        set status = 'voided'
        where referral_credit_id = v_credit.id and status in ('reserved', 'consumed');
      end if;
    end loop;
  end if;

  select * into v_used
  from public.referral_redemptions
  where service_visit_id = p_service_visit_id and status = 'consumed'
  for update;
  if v_used.id is not null then
    update public.referral_credits set status = 'review' where id = v_used.referral_credit_id;
  end if;
end;
$$;

create or replace function public.flag_shared_payment_method(p_customer_id uuid, p_payment_method_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_payment_method_id is null or length(p_payment_method_id) = 0 then
    return;
  end if;

  update public.referrals r
  set review_flags = (
      select array(select distinct flag from unnest(r.review_flags || array['shared_payment']) as flag)
    ),
    status = case when r.status = 'attributed' then 'review' else r.status end
  from public.referral_codes c
  join public.customers referrer on referrer.id = c.referrer_customer_id
  where r.referral_code_id = c.id
    and r.referred_customer_id = p_customer_id
    and referrer.stripe_default_payment_method_id = p_payment_method_id;

  update public.referrals r
  set review_flags = (
      select array(select distinct flag from unnest(r.review_flags || array['shared_payment']) as flag)
    ),
    status = case when r.status = 'attributed' then 'review' else r.status end
  from public.referral_codes c
  join public.customers friend on friend.id = r.referred_customer_id
  where r.referral_code_id = c.id
    and c.referrer_customer_id = p_customer_id
    and friend.stripe_default_payment_method_id = p_payment_method_id;
end;
$$;

revoke all on function public.create_customer_referral_code(uuid, text) from public, anon, authenticated;
revoke all on function public.create_admin_referral_code(uuid, text) from public, anon, authenticated;
revoke all on function public.set_referral_code_active(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.attribute_referral(text, uuid, text, text, text, boolean, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_referral_qualification(uuid) from public, anon, authenticated;
revoke all on function public.referral_pricing_facts(uuid) from public, anon, authenticated;
revoke all on function public.referral_visit_is_eligible(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.reserve_referral_credit(uuid) from public, anon, authenticated;
revoke all on function public.preview_referral_credit(uuid) from public, anon, authenticated;
revoke all on function public.consume_referral_redemption(uuid) from public, anon, authenticated;
revoke all on function public.restore_referral_redemption(uuid) from public, anon, authenticated;
revoke all on function public.reverse_referral_for_visit(uuid) from public, anon, authenticated;
revoke all on function public.flag_shared_payment_method(uuid, text) from public, anon, authenticated;

grant execute on function public.create_customer_referral_code(uuid, text) to service_role;
grant execute on function public.create_admin_referral_code(uuid, text) to service_role;
grant execute on function public.set_referral_code_active(uuid, boolean, uuid, text) to service_role;
grant execute on function public.attribute_referral(text, uuid, text, text, text, boolean, text, uuid, uuid, uuid) to service_role;
grant execute on function public.sync_referral_qualification(uuid) to service_role;
grant execute on function public.referral_pricing_facts(uuid) to service_role;
grant execute on function public.referral_visit_is_eligible(uuid, text, uuid) to service_role;
grant execute on function public.reserve_referral_credit(uuid) to service_role;
grant execute on function public.preview_referral_credit(uuid) to service_role;
grant execute on function public.consume_referral_redemption(uuid) to service_role;
grant execute on function public.restore_referral_redemption(uuid) to service_role;
grant execute on function public.reverse_referral_for_visit(uuid) to service_role;
grant execute on function public.flag_shared_payment_method(uuid, text) to service_role;

create or replace function public.protect_service_visit_payments_financial_facts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tip_confirmed_at is not null then
    if (
        new.service_visit_id is distinct from old.service_visit_id
        or new.service_visit_pricing_id is distinct from old.service_visit_pricing_id
        or new.approved_amount is distinct from old.approved_amount
        or new.tip_basis_amount is distinct from old.tip_basis_amount
        or new.tip_selection_type is distinct from old.tip_selection_type
        or new.tip_percentage is distinct from old.tip_percentage
        or new.tip_amount is distinct from old.tip_amount
        or new.tax_amount is distinct from old.tax_amount
        or new.total_amount is distinct from old.total_amount
        or new.referral_credit_amount is distinct from old.referral_credit_amount
        or new.tip_confirmed_at is distinct from old.tip_confirmed_at
      )
      and not (
        current_setting('app.allow_payment_revision_reset', true) = 'true'
        and new.status = 'created'
        and new.tip_confirmed_at is null
      )
    then
      raise exception
        'service_visit_payments financial facts are immutable once tip_confirmed_at is set (id=%)', old.id;
    end if;
  end if;

  if old.stripe_payment_intent_id is not null
    and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
    and old.status is distinct from 'payment_failed'
    and not (current_setting('app.allow_payment_revision_reset', true) = 'true' and new.stripe_payment_intent_id is null)
    and not (current_setting('app.allow_payment_retry_intent_clear', true) = 'true' and new.stripe_payment_intent_id is null)
  then
    raise exception
      'service_visit_payments.stripe_payment_intent_id can only be replaced when the prior attempt is dead (status=payment_failed), or cleared via start_visit_pricing_revision/begin_visit_payment_retry; current status=% (id=%)', old.status, old.id;
  end if;

  return new;
end;
$$;

create or replace function public.clear_referral_credit_when_payment_resets()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tip_confirmed_at is not null and new.tip_confirmed_at is null then
    new.referral_credit_amount := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists a_clear_referral_credit_when_payment_resets on public.service_visit_payments;

create trigger a_clear_referral_credit_when_payment_resets
before update on public.service_visit_payments
for each row execute function public.clear_referral_credit_when_payment_resets();
