-- ============================================================================
-- Migration: owner-private recipient label for Type B referral codes
--
-- AUTHORED ONLY. Do not apply to production (numabqpfnigejtdwpxng).
-- Preview only after an explicit sign-off.
--
-- authenticated can SELECT referral_codes columns. Policy
-- referral_codes_select allows a customer to read their own Type A row,
-- and an owner admin to read every code. anon has no grant. Portal
-- /my/rewards, quote attribution, and the referral RPCs do not return a
-- recipient label (customer reads select specific columns; RPCs return
-- jsonb built from named fields). A label on referral_codes would still be
-- readable through that SELECT grant, so it lives here instead.
--
-- This table has RLS enabled and no policies. anon and authenticated have
-- no privileges. service_role is the only granted role and is what the
-- admin server actions use after manage_referral_program is checked.
-- Existing functions, including create_admin_referral_code(uuid, text),
-- are not replaced.
-- ============================================================================

alter table public.referral_program_audit
  add column previous_value text,
  add column new_value text;

comment on column public.referral_program_audit.previous_value is
  'Previous recipient label for action_type recipient_label_updated. Null when the label was blank, and null for other actions.';

comment on column public.referral_program_audit.new_value is
  'New recipient label for action_type recipient_label_updated, and the initial label on code_issued when one was recorded. Null when blank.';

do $drop_action_check$
declare
  v_name text;
  v_dropped integer := 0;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.referral_program_audit'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%code_issued%'
      and pg_get_constraintdef(c.oid) not ilike '%recipient_label_updated%'
  loop
    execute format('alter table public.referral_program_audit drop constraint %I', v_name);
    v_dropped := v_dropped + 1;
  end loop;

  if v_dropped <> 1 then
    raise exception 'expected exactly one referral_program_audit action check to replace, dropped %', v_dropped;
  end if;
end
$drop_action_check$;

alter table public.referral_program_audit
  add constraint referral_program_audit_action_type_check
  check (action_type in ('code_issued', 'code_disabled', 'code_enabled', 'recipient_label_updated'));

create table public.referral_code_recipient_labels (
  code_id uuid primary key references public.referral_codes (id),
  recipient_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_code_recipient_labels_shape check (
    recipient_label is null
    or (
      char_length(recipient_label) between 1 and 120
      and recipient_label = regexp_replace(recipient_label, '^\s+|\s+$', '', 'g')
    )
  )
);

comment on table public.referral_code_recipient_labels is
  'Owner-private note of who a Type B code was given to. Blank labels are stored as null. Customers and anon have no access.';

comment on column public.referral_code_recipient_labels.recipient_label is
  'Trimmed label, 1 to 120 characters, or null. Only Type B (admin_issued) codes may have a row.';

create function public.normalize_referral_recipient_label(p_label text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_label text;
begin
  v_label := nullif(regexp_replace(coalesce(p_label, ''), '^\s+|\s+$', '', 'g'), '');
  if v_label is not null and char_length(v_label) > 120 then
    raise exception 'RECIPIENT_LABEL_TOO_LONG';
  end if;
  return v_label;
end;
$$;

create function public.enforce_referral_code_recipient_label()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type text;
begin
  select code_type into v_type
  from public.referral_codes
  where id = new.code_id;

  if v_type is distinct from 'admin_issued' then
    raise exception 'RECIPIENT_LABEL_TYPE_A_REJECTED';
  end if;

  new.recipient_label := public.normalize_referral_recipient_label(new.recipient_label);
  return new;
end;
$$;

create trigger referral_code_recipient_labels_enforce
before insert or update on public.referral_code_recipient_labels
for each row execute function public.enforce_referral_code_recipient_label();

create trigger referral_code_recipient_labels_set_updated_at
before update on public.referral_code_recipient_labels
for each row execute function public.set_updated_at();

alter table public.referral_code_recipient_labels enable row level security;

revoke all on public.referral_code_recipient_labels from public, anon, authenticated, service_role;
grant select, insert, update on public.referral_code_recipient_labels to service_role;

revoke all on function public.normalize_referral_recipient_label(text) from public, anon, authenticated;
revoke all on function public.enforce_referral_code_recipient_label() from public, anon, authenticated;
grant execute on function public.normalize_referral_recipient_label(text) to service_role;
grant execute on function public.enforce_referral_code_recipient_label() to service_role;

create function public.create_admin_referral_code_with_label(
  p_admin_user_id uuid,
  p_code text,
  p_recipient_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_label text;
begin
  v_label := public.normalize_referral_recipient_label(p_recipient_label);

  insert into public.referral_codes (code, code_type, issued_by_admin_user_id)
  values (p_code, 'admin_issued', p_admin_user_id)
  returning id, code into v_id, v_code;

  insert into public.referral_program_audit (actor_admin_user_id, action_type, target_id, new_value)
  values (p_admin_user_id, 'code_issued', v_id, v_label);

  if v_label is not null then
    insert into public.referral_code_recipient_labels (code_id, recipient_label)
    values (v_id, v_label);
  end if;

  return jsonb_build_object('code', v_code, 'id', v_id);
exception when unique_violation then
  raise exception 'REFERRAL_CODE_COLLISION';
end;
$$;

create function public.update_admin_referral_code_recipient_label(
  p_code_id uuid,
  p_admin_user_id uuid,
  p_recipient_label text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_old text;
  v_new text;
  v_attempt integer;
  v_done boolean := false;
begin
  v_new := public.normalize_referral_recipient_label(p_recipient_label);

  select code_type into v_type
  from public.referral_codes
  where id = p_code_id;

  if not found then
    raise exception 'UNKNOWN_CODE';
  end if;

  if v_type is distinct from 'admin_issued' then
    raise exception 'RECIPIENT_LABEL_TYPE_A_REJECTED';
  end if;

  for v_attempt in 1..3 loop
    select recipient_label into v_old
    from public.referral_code_recipient_labels
    where code_id = p_code_id
    for update;

    if found then
      update public.referral_code_recipient_labels
      set recipient_label = v_new
      where code_id = p_code_id;
      v_done := true;
    else
      begin
        insert into public.referral_code_recipient_labels (code_id, recipient_label)
        values (p_code_id, v_new);
        v_old := null;
        v_done := true;
      exception when unique_violation then
        if v_attempt = 3 then
          raise;
        end if;
      end;
    end if;

    exit when v_done;
  end loop;

  if not v_done then
    raise exception 'RECIPIENT_LABEL_WRITE_FAILED';
  end if;

  insert into public.referral_program_audit (
    actor_admin_user_id,
    action_type,
    target_id,
    previous_value,
    new_value
  ) values (
    p_admin_user_id,
    'recipient_label_updated',
    p_code_id,
    v_old,
    v_new
  );
end;
$$;

revoke all on function public.create_admin_referral_code_with_label(uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_admin_referral_code_recipient_label(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_admin_referral_code_with_label(uuid, text, text) to service_role;
grant execute on function public.update_admin_referral_code_recipient_label(uuid, uuid, text) to service_role;

comment on function public.create_admin_referral_code_with_label(uuid, text, text) is
  'Issues a Type B code and, when provided, its recipient label in one transaction. Does not replace create_admin_referral_code(uuid, text).';

comment on function public.update_admin_referral_code_recipient_label(uuid, uuid, text) is
  'Sets or clears a Type B recipient label and writes recipient_label_updated with the previous and new values. Rejects Type A codes. Does not change the code, its active flag, attribution, credits, or redemptions.';
