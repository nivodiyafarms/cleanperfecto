-- ============================================================================
-- Migration: create service_visit_pricing table
-- My CleanPerfecto — Customer Portal V1 milestone.
--
-- Per-visit price authority for a real service_visits row that isn't
-- already fully priced by booking_orders (i.e. any visit generated under a
-- recurring_schedule_id — the second-and-later visit of a recurring
-- relationship, package or Pay Per Cleaning alike). booking_orders remains
-- the price of record for the one directly-booked first visit; this table
-- never duplicates that.
--
-- One table serves BOTH Pay Per Cleaning and prepaid-package visits — the
-- shape (base + add-ons + total + approval + payment state) is identical;
-- only the INTERPRETATION of base_amount differs, derived at read time from
-- service_visits.prepaid_package_id (covered by the package vs charged to
-- the customer), never a separately stored flag here.
--
-- price_status and payment_status are DELIBERATELY separate state
-- machines (owner-approved correction): pricing confirmation/customer
-- approval is one lifecycle (is the amount right, has the customer signed
-- off on an increase), payment collection is a completely independent one
-- (has that already-confirmed amount actually been paid). Conflating them
-- into a single enum would force every payment-state addition to also
-- reason about pricing approval and vice versa.
--
-- Rows are created lazily — only when there is something to price (an
-- admin confirming a Pay Per Cleaning visit's amount, or a customer/admin
-- adding extras to any visit). No row for a visit means "nothing priced
-- yet / no extras" — a fully valid empty state, not a missing one.
-- ============================================================================

create table public.service_visit_pricing (
  id uuid primary key default gen_random_uuid(),

  service_visit_id uuid not null unique references public.service_visits (id),

  pricing_version text not null,
  pricing_snapshot jsonb not null,

  base_amount numeric(10, 2) not null default 0,
  add_on_ids text[] not null default '{}',
  add_on_amount numeric(10, 2) not null default 0,
  total_amount numeric(10, 2) not null default 0,
  amount_due_from_customer numeric(10, 2) not null default 0,

  price_status text not null default 'estimated'
    check (price_status in ('estimated', 'pending_customer_approval', 'confirmed')),
  payment_status text not null default 'not_applicable'
    check (payment_status in (
      'not_applicable', 'awaiting_completion', 'awaiting_payment', 'paid', 'payment_failed'
    )),

  previously_approved_amount numeric(10, 2),
  requires_customer_approval boolean not null default false,

  confirmed_at timestamptz,
  confirmed_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_visit_pricing is
  'Per-visit price authority for any service_visits row generated under a recurring relationship (Pay Per Cleaning or prepaid-package). base_amount is 0/covered for a package-linked visit (service_visits.prepaid_package_id is not null) and only add_on_amount is customer-owed; for a Pay Per Cleaning visit, base_amount is the recomputed cleaning price and amount_due_from_customer = total_amount. price_status and payment_status are independent state machines — see column comments.';

comment on column public.service_visit_pricing.price_status is
  'estimated: a computed amount exists but is not yet admin-confirmed. pending_customer_approval: total_amount exceeds previously_approved_amount and needs customer sign-off. confirmed: admin has confirmed this is the final amount for this visit. Independent of payment_status.';

comment on column public.service_visit_pricing.payment_status is
  'not_applicable: nothing customer-owed yet to track (e.g. package base with no extras). awaiting_completion: an amount is owed but the visit has not completed yet — no charge exists to collect against. awaiting_payment: the visit completed and payment is outstanding. paid / payment_failed: terminal-ish states, admin-recorded for V1 (no automatic post-completion charging is built yet). Independent of price_status.';

comment on column public.service_visit_pricing.previously_approved_amount is
  'The last customer-approved total_amount. Null until the first confirmation. requires_customer_approval is set only when a newly computed total_amount EXCEEDS this value — a same-or-lower re-estimate never blocks on approval.';

comment on column public.service_visit_pricing.confirmed_by is
  'Free-text actor tag (e.g. "admin:<admin_user_id>") — no generalized actor FK exists in this schema yet, same convention as package_amendments.initiated_by_note.';

-- Freeze every pricing/amount/status field once the parent service_visit
-- has completed — mirrors protect_package_amendment_pricing()'s intent
-- (20260822091000_create_package_amendments.sql): historical completed
-- visit pricing must never be rewritten. payment_status is the one
-- exception left mutable after completion, since a completed visit's
-- payment can still legitimately move awaiting_payment -> paid/failed.
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
    then
      raise exception
        'service_visit_pricing pricing fields are immutable once the parent service_visit has completed (service_visit_id=%). payment_status remains updatable.',
        old.service_visit_id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_service_visit_pricing_after_completion() is
  'BEFORE UPDATE guard: once the parent service_visits.status = ''completed'', rejects any change to pricing/amount/price_status fields. payment_status (and confirmed_at/confirmed_by, already frozen in practice once price_status=confirmed) may still transition, since a completed visit''s payment can legitimately move afterward.';

create trigger service_visit_pricing_protect_after_completion
before update on public.service_visit_pricing
for each row execute function public.protect_service_visit_pricing_after_completion();

create trigger service_visit_pricing_set_updated_at
before update on public.service_visit_pricing
for each row execute function public.set_updated_at();

alter table public.service_visit_pricing enable row level security;

revoke all privileges
on table public.service_visit_pricing
from anon, authenticated;

grant select, insert, update
on table public.service_visit_pricing
to service_role;
-- No delete grant — a visit's pricing record is never removed, only
-- superseded in place (pre-completion) or frozen (post-completion).
