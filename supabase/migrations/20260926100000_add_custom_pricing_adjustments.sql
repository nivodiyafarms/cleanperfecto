-- ============================================================================
-- Migration: custom pricing adjustments (Custom Charges / Custom Discounts)
-- Final Scope / Final Total milestone.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Extends the EXISTING service_visit_pricing row rather than a new table —
-- it already is the per-visit price authority (base + predefined add-ons +
-- total + approval), and an admin-entered custom charge/discount is just
-- one more input to that same authoritative total, not a second pricing
-- concept. custom_adjustments is a JSONB array (multiple adjustments per
-- visit, each individually removable by its own id before Finalize & Send)
-- mirroring the existing pricing_snapshot jsonb column's precedent on this
-- exact table; custom_charge_amount/custom_discount_amount are denormalized
-- running totals (mirroring add_on_amount's own relationship to
-- add_on_ids) so the pricing engine never has to re-sum the array to get
-- the number it actually needs for the total-amount formula.
--
-- Array shape (application-level, not DB-enforced beyond "is a JSON
-- array"): [{ id, type: 'custom_charge'|'custom_discount', description,
-- amount, addedByAdminUserId, addedByRole, addedAt }].
--
-- Two atomic RPCs (add/remove), each combining the array/aggregate mutation
-- with the required financial_audit_log actor-attribution row in one
-- transaction — same convention as every other *_with_audit RPC in this
-- schema (refund_visit_payment_with_audit, waive_service_fee_assessment_
-- with_audit, cancel_prepaid_package_with_refund_audit, ...). Authorization
-- (custom charges follow the existing final-scope capability; discounts
-- are owner-only, a financial correction) is enforced by the calling
-- application code via assertCapability() BEFORE either RPC is ever
-- reached — these RPCs trust p_actor_role as-is, identical trust boundary
-- to every other *_with_audit RPC already in this schema.
--
-- These RPCs deliberately do NOT recompute total_amount/amount_due_from_
-- customer/requires_customer_approval — that recomputation (base-amount
-- resolution from recurring scope versions or booking orders, the add-on
-- catalog, the approved-vs-final approval comparison, the pricing_
-- approval_required notification) is non-trivial application logic that
-- already exists in full in estimateVisitPricing()
-- (src/lib/scheduling/estimate-visit-pricing.ts) and must never be
-- duplicated in SQL. The calling domain function
-- (add-custom-pricing-adjustment.ts / remove-custom-pricing-adjustment.ts)
-- always calls estimateVisitPricing() again immediately after either RPC,
-- within the same request, to fold the new aggregate into an authoritative
-- total. The no-negative-payable guard below is therefore a defensive,
-- best-effort check against the row's CURRENTLY PERSISTED base/add-on
-- amounts (a real backstop, not a race-prone final word) — the immediately
-- following estimateVisitPricing() call is what actually clamps the
-- authoritative total, using its own freshly-resolved base amount.
-- ============================================================================

alter table public.service_visit_pricing
  add column custom_adjustments jsonb not null default '[]',
  add column custom_charge_amount numeric(10, 2) not null default 0 check (custom_charge_amount >= 0),
  add column custom_discount_amount numeric(10, 2) not null default 0 check (custom_discount_amount >= 0);

comment on column public.service_visit_pricing.custom_adjustments is
  'Admin-entered custom charges/discounts for this visit''s Final Scope, in insertion order. Each element: {id, type: custom_charge|custom_discount, description, amount, addedByAdminUserId, addedByRole, addedAt}. Mutated ONLY by add_custom_pricing_adjustment_with_audit/remove_custom_pricing_adjustment_with_audit — never written directly by estimateVisitPricing()''s own plain upsert, which only ever reads and preserves it unchanged.';

comment on column public.service_visit_pricing.custom_charge_amount is
  'Sum of custom_adjustments where type=custom_charge — denormalized for the pricing-total formula, same relationship add_on_amount has to add_on_ids. Kept in sync by add/remove_custom_pricing_adjustment_with_audit; never independently derived elsewhere.';

comment on column public.service_visit_pricing.custom_discount_amount is
  'Sum of custom_adjustments where type=custom_discount — a positive magnitude representing the amount SUBTRACTED from the total (never store this as a negative number). Kept in sync by add/remove_custom_pricing_adjustment_with_audit.';

-- Extend the existing post-completion freeze guard to also cover the three
-- new columns — historical completed-visit pricing must never be rewritten,
-- same rule as every other pricing/amount field on this table.
create or replace function public.protect_service_visit_pricing_after_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_visit_status text;
begin
  select status into v_visit_status from service_visits where id = old.service_visit_id;

  if v_visit_status = 'completed' then
    if new.pricing_snapshot is distinct from old.pricing_snapshot
      or new.base_amount is distinct from old.base_amount
      or new.add_on_ids is distinct from old.add_on_ids
      or new.add_on_amount is distinct from old.add_on_amount
      or new.total_amount is distinct from old.total_amount
      or new.amount_due_from_customer is distinct from old.amount_due_from_customer
      or new.price_status is distinct from old.price_status
      or new.previously_approved_amount is distinct from old.previously_approved_amount
      or new.custom_adjustments is distinct from old.custom_adjustments
      or new.custom_charge_amount is distinct from old.custom_charge_amount
      or new.custom_discount_amount is distinct from old.custom_discount_amount
    then
      raise exception
        'service_visit_pricing pricing fields are immutable once the parent service_visit has completed (service_visit_id=%). payment_status remains updatable.',
        old.service_visit_id;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_custom_pricing_adjustment_with_audit
-- ---------------------------------------------------------------------------
create or replace function public.add_custom_pricing_adjustment_with_audit(
  p_service_visit_pricing_id uuid,
  p_type text,
  p_description text,
  p_amount numeric(10, 2),
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.service_visit_pricing
language plpgsql
set search_path = public
as $$
declare
  v_pricing service_visit_pricing;
  v_adjustment_id uuid := gen_random_uuid();
  v_new_adjustment jsonb;
  v_new_charge_amount numeric(10, 2);
  v_new_discount_amount numeric(10, 2);
  v_hypothetical_total numeric(10, 2);
begin
  if p_type not in ('custom_charge', 'custom_discount') then
    raise exception 'add_custom_pricing_adjustment_with_audit: invalid p_type %', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'add_custom_pricing_adjustment_with_audit: p_amount must be positive, got %', p_amount;
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'add_custom_pricing_adjustment_with_audit: p_description is required';
  end if;

  select * into v_pricing from service_visit_pricing where id = p_service_visit_pricing_id for update;
  if v_pricing.id is null then
    raise exception 'service_visit_pricing % not found', p_service_visit_pricing_id;
  end if;

  v_new_charge_amount := v_pricing.custom_charge_amount + case when p_type = 'custom_charge' then p_amount else 0 end;
  v_new_discount_amount := v_pricing.custom_discount_amount + case when p_type = 'custom_discount' then p_amount else 0 end;

  -- Defensive backstop only — see this migration's header comment. Uses the
  -- row's currently persisted base_amount/add_on_amount, not a re-resolved
  -- one; the caller's immediately-following estimateVisitPricing() call is
  -- the actual authoritative clamp.
  if p_type = 'custom_discount' then
    v_hypothetical_total := v_pricing.base_amount + v_pricing.add_on_amount + v_new_charge_amount - v_new_discount_amount;
    if v_hypothetical_total < 0 then
      raise exception 'add_custom_pricing_adjustment_with_audit: this discount would reduce the payable amount below $0 (would be %)', v_hypothetical_total;
    end if;
  end if;

  v_new_adjustment := jsonb_build_object(
    'id', v_adjustment_id,
    'type', p_type,
    'description', p_description,
    'amount', p_amount,
    'addedByAdminUserId', p_actor_admin_user_id,
    'addedByRole', p_actor_role,
    'addedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  update service_visit_pricing
  set custom_adjustments = coalesce(custom_adjustments, '[]'::jsonb) || v_new_adjustment,
      custom_charge_amount = v_new_charge_amount,
      custom_discount_amount = v_new_discount_amount
  where id = p_service_visit_pricing_id
  returning * into v_pricing;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type, target_entity_type, target_entity_id, service_visit_id, reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role,
    case when p_type = 'custom_charge' then 'custom_charge_added' else 'custom_discount_added' end,
    'service_visit_pricing', p_service_visit_pricing_id, v_pricing.service_visit_id,
    p_description,
    jsonb_build_object('adjustmentId', v_adjustment_id, 'type', p_type, 'description', p_description, 'amount', p_amount)
  );

  return v_pricing;
end;
$$;

comment on function public.add_custom_pricing_adjustment_with_audit(uuid, text, text, numeric, uuid, text) is
  'Atomically appends one custom charge/discount adjustment to service_visit_pricing.custom_adjustments (updating the matching aggregate column) AND records the required financial_audit_log actor-attribution row in one transaction. Rejects a non-positive amount, a blank description, or a discount that would drive the payable amount (per the row''s currently persisted base/add-on amounts) below $0. See src/lib/scheduling/add-custom-pricing-adjustment.ts, the sole caller — which always re-runs estimateVisitPricing() immediately afterward for the actual authoritative total/approval recompute.';

revoke all on function public.add_custom_pricing_adjustment_with_audit(uuid, text, text, numeric, uuid, text)
from public, anon, authenticated;

grant execute on function public.add_custom_pricing_adjustment_with_audit(uuid, text, text, numeric, uuid, text)
to service_role;

-- ---------------------------------------------------------------------------
-- remove_custom_pricing_adjustment_with_audit
-- ---------------------------------------------------------------------------
create or replace function public.remove_custom_pricing_adjustment_with_audit(
  p_service_visit_pricing_id uuid,
  p_adjustment_id uuid,
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.service_visit_pricing
language plpgsql
set search_path = public
as $$
declare
  v_pricing service_visit_pricing;
  v_removed jsonb;
  v_remaining jsonb;
  v_type text;
  v_amount numeric(10, 2);
  v_description text;
begin
  select * into v_pricing from service_visit_pricing where id = p_service_visit_pricing_id for update;
  if v_pricing.id is null then
    raise exception 'service_visit_pricing % not found', p_service_visit_pricing_id;
  end if;

  select elem into v_removed
  from jsonb_array_elements(coalesce(v_pricing.custom_adjustments, '[]'::jsonb)) as elem
  where elem->>'id' = p_adjustment_id::text;

  if v_removed is null then
    raise exception 'custom adjustment % not found on service_visit_pricing %', p_adjustment_id, p_service_visit_pricing_id;
  end if;

  v_type := v_removed->>'type';
  v_amount := (v_removed->>'amount')::numeric(10, 2);
  v_description := v_removed->>'description';

  select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_remaining
  from jsonb_array_elements(v_pricing.custom_adjustments) as elem
  where elem->>'id' <> p_adjustment_id::text;

  update service_visit_pricing
  set custom_adjustments = v_remaining,
      custom_charge_amount = custom_charge_amount - case when v_type = 'custom_charge' then v_amount else 0 end,
      custom_discount_amount = custom_discount_amount - case when v_type = 'custom_discount' then v_amount else 0 end
  where id = p_service_visit_pricing_id
  returning * into v_pricing;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type, target_entity_type, target_entity_id, service_visit_id, reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role,
    case when v_type = 'custom_charge' then 'custom_charge_removed' else 'custom_discount_removed' end,
    'service_visit_pricing', p_service_visit_pricing_id, v_pricing.service_visit_id,
    v_description,
    jsonb_build_object('adjustmentId', p_adjustment_id, 'type', v_type, 'description', v_description, 'amount', v_amount)
  );

  return v_pricing;
end;
$$;

comment on function public.remove_custom_pricing_adjustment_with_audit(uuid, uuid, uuid, text) is
  'Atomically removes one custom charge/discount adjustment (by its own id) from service_visit_pricing.custom_adjustments (updating the matching aggregate column) AND records the required financial_audit_log actor-attribution row in one transaction. Raises if the adjustment id does not exist on this row. See src/lib/scheduling/remove-custom-pricing-adjustment.ts, the sole caller.';

revoke all on function public.remove_custom_pricing_adjustment_with_audit(uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.remove_custom_pricing_adjustment_with_audit(uuid, uuid, uuid, text)
to service_role;

-- ---------------------------------------------------------------------------
-- financial_audit_log.action_type: widen for the four new action types —
-- same additive widening pattern as every prior occurrence (tax_reversal_
-- reconciled, fee_collected, invoice_voided, ...). Does not touch any
-- existing row or any other allowed value.
-- ---------------------------------------------------------------------------
alter table public.financial_audit_log
  drop constraint financial_audit_log_action_type_check;

alter table public.financial_audit_log
  add constraint financial_audit_log_action_type_check
  check (action_type in (
    'external_payment_recorded',
    'fee_waived',
    'refund_issued',
    'financial_correction',
    'tax_override',
    'role_changed',
    'payment_configuration_changed',
    'tax_reversal_reconciled',
    'fee_collected',
    'invoice_voided',
    'custom_charge_added',
    'custom_charge_removed',
    'custom_discount_added',
    'custom_discount_removed'
  ));

-- ---------------------------------------------------------------------------
-- invoices: itemized custom-charge detail (mirrors add_ons_amount/add_ons_
-- detail exactly) + itemized discount detail. discount_amount (existing
-- column, never previously populated by any real code path — see
-- build-service-visit-invoice.ts prior to this milestone) becomes the real
-- net-discount aggregate for the first time; discount_description (also
-- previously unused) is left as-is for any future single-line use and is
-- not populated by this milestone's multi-item flow.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column custom_charges_amount numeric(10, 2) not null default 0 check (custom_charges_amount >= 0),
  add column custom_charges_detail jsonb not null default '[]',
  add column discount_detail jsonb not null default '[]';

comment on column public.invoices.custom_charges_amount is
  'Sum of admin-entered custom charges included in this invoice''s subtotal — same relationship add_ons_amount has to add_ons_detail.';
comment on column public.invoices.custom_charges_detail is
  'Per-charge {description, amount} snapshot at issuance, same shape/intent as add_ons_detail.';
comment on column public.invoices.discount_detail is
  'Per-discount {description, amount} snapshot at issuance. discount_amount is the sum of these amounts.';

-- ---------------------------------------------------------------------------
-- issue_invoice(): widen to accept the three new columns above. Postgres
-- treats an added parameter as a different overload, not a replacement, so
-- the original 29-parameter signature is dropped first (mirrors
-- 20260920100000_add_prepaid_package_tax_refund_accounting.sql's own
-- drop-then-recreate of cancel_prepaid_package_with_refund_audit for the
-- exact same reason). Every other column/behavior is unchanged. The sole
-- caller (src/lib/scheduling/supabase-scheduling-repository.ts's
-- issueInvoice) is updated in this same commit to match.
-- ---------------------------------------------------------------------------
drop function if exists public.issue_invoice(
  text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, jsonb
);

create or replace function public.issue_invoice(
  p_source_type text,
  p_service_visit_id uuid,
  p_prepaid_package_id uuid,
  p_service_visit_pricing_id uuid,
  p_service_fee_assessment_id uuid,
  p_customer_id uuid,
  p_customer_display_name text,
  p_description text,
  p_service_address_line1 text,
  p_service_address_line2 text,
  p_service_city text,
  p_service_state text,
  p_service_zip text,
  p_service_date date,
  p_cleaning_type text,
  p_currency text,
  p_base_amount numeric,
  p_room_adjustments_amount numeric,
  p_add_ons_amount numeric,
  p_add_ons_detail jsonb,
  p_travel_amount numeric,
  p_supplies_amount numeric,
  p_custom_charges_amount numeric,
  p_custom_charges_detail jsonb,
  p_discount_amount numeric,
  p_discount_description text,
  p_discount_detail jsonb,
  p_cancellation_fee_amount numeric,
  p_tax_amount numeric,
  p_subtotal_amount numeric,
  p_total_amount numeric,
  p_pricing_snapshot jsonb
)
returns public.invoices
language plpgsql
set search_path = public
as $$
declare
  v_number bigint;
  v_invoice_number text;
  v_invoice invoices;
begin
  v_number := allocate_document_number('invoice', extract(year from now())::integer);
  v_invoice_number := 'CP-INV-' || extract(year from now())::text || '-' || lpad(v_number::text, 6, '0');

  insert into invoices (
    invoice_number, source_type, service_visit_id, prepaid_package_id,
    service_visit_pricing_id, service_fee_assessment_id, customer_id,
    customer_display_name, description,
    service_address_line1, service_address_line2, service_city, service_state, service_zip,
    service_date, cleaning_type, currency,
    base_amount, room_adjustments_amount, add_ons_amount, add_ons_detail,
    travel_amount, supplies_amount,
    custom_charges_amount, custom_charges_detail,
    discount_amount, discount_description, discount_detail,
    cancellation_fee_amount, tax_amount, subtotal_amount, total_amount,
    pricing_snapshot
  ) values (
    v_invoice_number, p_source_type, p_service_visit_id, p_prepaid_package_id,
    p_service_visit_pricing_id, p_service_fee_assessment_id, p_customer_id,
    p_customer_display_name, p_description,
    p_service_address_line1, p_service_address_line2, p_service_city, p_service_state, p_service_zip,
    p_service_date, p_cleaning_type, p_currency,
    p_base_amount, p_room_adjustments_amount, p_add_ons_amount, p_add_ons_detail,
    p_travel_amount, p_supplies_amount,
    p_custom_charges_amount, p_custom_charges_detail,
    p_discount_amount, p_discount_description, p_discount_detail,
    p_cancellation_fee_amount, p_tax_amount, p_subtotal_amount, p_total_amount,
    p_pricing_snapshot
  )
  returning * into v_invoice;

  return v_invoice;
end;
$$;

comment on function public.issue_invoice(
  text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, jsonb, numeric, text, jsonb, numeric, numeric, numeric, numeric, jsonb
) is
  'Allocates the next CP-INV-YYYY-###### number and inserts the invoice row in one call, now including custom-charge/discount detail. Sole caller: src/lib/scheduling/supabase-scheduling-repository.ts''s issueInvoice.';

revoke all on function public.issue_invoice(
  text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, jsonb, numeric, text, jsonb, numeric, numeric, numeric, numeric, jsonb
) from public, anon, authenticated;

grant execute on function public.issue_invoice(
  text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, jsonb, numeric, text, jsonb, numeric, numeric, numeric, numeric, jsonb
) to service_role;
