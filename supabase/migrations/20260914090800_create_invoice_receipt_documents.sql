-- ============================================================================
-- Migration: invoice + receipt documents (Phase I)
-- Live-payment hardening milestone — Phase I: CleanPerfecto invoice/receipt
-- generation for every settled financial event (visit payment, cancellation
-- fee collection, prepaid package purchase).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Two distinct documents, deliberately not one table:
--   invoices  — the approved financial SNAPSHOT for what is owed (or was
--               owed) for a service visit or a prepaid package purchase.
--               Every fact column is frozen at insert time (see the freeze
--               trigger below) — an invoice documents what was true at
--               issuance, and is corrected only via an explicit, audited
--               void, never by silently rewriting a column.
--   receipts  — the actual SETTLED money-movement fact for one payment
--               event. Fully append-only (no update grant at all, same
--               convention as financial_audit_log) — a receipt is never
--               edited after creation. Later refunds/disputes against the
--               same money remain visible on their own existing source-of-
--               truth tables (service_visit_payments.refunded_amount,
--               prepaid_packages.refunded_amount, stripe_disputes) rather
--               than being duplicated onto the receipt row — the printable
--               receipt page joins those tables live for current refund/
--               dispute status, so this table never needs to be told about
--               an event that happens after its own creation.
--
-- Both documents are issued together, server-side, at the moment a
-- financial event actually settles (see issue_invoice/issue_receipt below,
-- called from reconcile-visit-payment.ts, record-external-payment.ts,
-- collect-service-fee.ts, and the webhook's prepaid-package activation
-- path) — never earlier (this milestone has no separate pre-payment
-- "estimate" document; that's the existing Review Charges UI, not a formal
-- invoice) and never re-issued for the same settlement.
--
-- Numbering: CP-INV-YYYY-###### / CP-RCT-YYYY-######, allocated by
-- document_number_counters via an atomic INSERT ... ON CONFLICT DO UPDATE
-- increment (see allocate_document_number below) — no SELECT MAX(...)+1
-- anywhere. This project has no precedent for native Postgres SEQUENCEs
-- (grepped: none exist), and a plain CREATE SEQUENCE doesn't reset per
-- calendar year on its own, so a small counter table keyed by
-- (document_type, year) is the concurrency-safe mechanism used here —
-- the same atomicity guarantee a SEQUENCE would give (Postgres serializes
-- concurrent INSERT ... ON CONFLICT DO UPDATE against the same row), with
-- year-scoped numbering as a natural consequence of the composite key.
-- Gaps are possible if an issuing transaction rolls back after allocating
-- a number — expected and acceptable, identical to native SEQUENCE
-- behavior; uniqueness (not denseness) is the actual requirement.
-- ============================================================================

create table public.document_number_counters (
  document_type text not null check (document_type in ('invoice', 'receipt')),
  year integer not null check (year >= 2020),
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (document_type, year)
);

comment on table public.document_number_counters is
  'Concurrency-safe per-year counters for invoice/receipt numbering — allocate_document_number() increments atomically via INSERT ... ON CONFLICT DO UPDATE. Never read/written any other way.';

create or replace function public.allocate_document_number(p_document_type text, p_year integer)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_number bigint;
begin
  insert into document_number_counters (document_type, year, last_number)
  values (p_document_type, p_year, 1)
  on conflict (document_type, year)
  do update set last_number = document_number_counters.last_number + 1, updated_at = now()
  returning last_number into v_number;

  return v_number;
end;
$$;

comment on function public.allocate_document_number(text, integer) is
  'Atomically allocates the next sequence number for (document_type, year) — INSERT ... ON CONFLICT DO UPDATE is a single indivisible statement, safe under concurrent callers with no explicit locking needed. Sole callers: issue_invoice, issue_receipt.';

alter table public.document_number_counters enable row level security;

revoke all privileges
on table public.document_number_counters
from anon, authenticated;

grant select, insert, update
on table public.document_number_counters
to service_role;
revoke truncate, references, trigger
on public.document_number_counters
from service_role;

revoke all on function public.allocate_document_number(text, integer) from public, anon, authenticated;
grant execute on function public.allocate_document_number(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),

  invoice_number text not null unique,

  source_type text not null check (source_type in ('service_visit', 'prepaid_package')),
  service_visit_id uuid references public.service_visits (id),
  prepaid_package_id uuid references public.prepaid_packages (id),
  service_visit_pricing_id uuid references public.service_visit_pricing (id),
  service_fee_assessment_id uuid references public.service_fee_assessments (id),

  customer_id uuid not null references public.customers (id),

  -- Snapshotted at issuance — a later edit to customers.name or
  -- service_visits' address must never rewrite an already-issued invoice's
  -- historical record of what was billed to whom, at what address.
  customer_display_name text not null,
  description text not null,
  service_address_line1 text,
  service_address_line2 text,
  service_city text,
  service_state text,
  service_zip text,
  service_date date,
  cleaning_type text,

  issue_date timestamptz not null default now(),
  currency text not null default 'usd',

  base_amount numeric(10, 2) not null default 0 check (base_amount >= 0),
  room_adjustments_amount numeric(10, 2) not null default 0,
  add_ons_amount numeric(10, 2) not null default 0 check (add_ons_amount >= 0),
  add_ons_detail jsonb not null default '[]',
  travel_amount numeric(10, 2) not null default 0 check (travel_amount >= 0),
  supplies_amount numeric(10, 2) not null default 0 check (supplies_amount >= 0),
  discount_amount numeric(10, 2) not null default 0 check (discount_amount >= 0),
  discount_description text,
  cancellation_fee_amount numeric(10, 2) not null default 0 check (cancellation_fee_amount >= 0),
  tax_amount numeric(10, 2) not null default 0 check (tax_amount >= 0),
  subtotal_amount numeric(10, 2) not null check (subtotal_amount >= 0),
  total_amount numeric(10, 2) not null check (total_amount >= 0),

  -- Full copy of service_visit_pricing.pricing_snapshot at issuance, for
  -- traceability — never re-read live.
  pricing_snapshot jsonb,

  payment_status text not null default 'paid'
    check (payment_status in ('unpaid', 'paid', 'partially_paid', 'void')),

  void_at timestamptz,
  void_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_source_type_reference_check check (
    (source_type = 'service_visit' and service_visit_id is not null and prepaid_package_id is null)
    or (source_type = 'prepaid_package' and prepaid_package_id is not null and service_visit_id is null)
  ),
  constraint invoices_void_fields_check check (
    (payment_status = 'void' and void_at is not null)
    or (payment_status != 'void' and void_at is null and void_reason is null)
  )
);

comment on table public.invoices is
  'The approved financial snapshot for a settled service visit or prepaid package purchase. Every fact column (everything except payment_status/void_at/void_reason/updated_at) is frozen at insert by protect_invoice_facts — corrections happen only via void_invoice_with_audit, never a silent column rewrite. Issued once, atomically with its number, by issue_invoice().';

comment on column public.invoices.customer_display_name is
  'Snapshotted from customers.name at issuance — customers.name changing later must never rewrite an already-issued invoice.';

comment on column public.invoices.pricing_snapshot is
  'Copy of service_visit_pricing.pricing_snapshot at issuance time, null for a prepaid_package invoice (no single service_visit_pricing row applies).';

create index invoices_customer_id_idx on public.invoices (customer_id);
create index invoices_service_visit_id_idx on public.invoices (service_visit_id) where service_visit_id is not null;
create index invoices_prepaid_package_id_idx on public.invoices (prepaid_package_id) where prepaid_package_id is not null;

create or replace function public.protect_invoice_facts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.invoice_number is distinct from old.invoice_number
    or new.source_type is distinct from old.source_type
    or new.service_visit_id is distinct from old.service_visit_id
    or new.prepaid_package_id is distinct from old.prepaid_package_id
    or new.service_visit_pricing_id is distinct from old.service_visit_pricing_id
    or new.service_fee_assessment_id is distinct from old.service_fee_assessment_id
    or new.customer_id is distinct from old.customer_id
    or new.customer_display_name is distinct from old.customer_display_name
    or new.description is distinct from old.description
    or new.service_address_line1 is distinct from old.service_address_line1
    or new.service_address_line2 is distinct from old.service_address_line2
    or new.service_city is distinct from old.service_city
    or new.service_state is distinct from old.service_state
    or new.service_zip is distinct from old.service_zip
    or new.service_date is distinct from old.service_date
    or new.cleaning_type is distinct from old.cleaning_type
    or new.issue_date is distinct from old.issue_date
    or new.currency is distinct from old.currency
    or new.base_amount is distinct from old.base_amount
    or new.room_adjustments_amount is distinct from old.room_adjustments_amount
    or new.add_ons_amount is distinct from old.add_ons_amount
    or new.add_ons_detail is distinct from old.add_ons_detail
    or new.travel_amount is distinct from old.travel_amount
    or new.supplies_amount is distinct from old.supplies_amount
    or new.discount_amount is distinct from old.discount_amount
    or new.discount_description is distinct from old.discount_description
    or new.cancellation_fee_amount is distinct from old.cancellation_fee_amount
    or new.tax_amount is distinct from old.tax_amount
    or new.subtotal_amount is distinct from old.subtotal_amount
    or new.total_amount is distinct from old.total_amount
    or new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.created_at is distinct from old.created_at
  then
    raise exception 'invoices facts are immutable once issued (id=%); only payment_status/void_at/void_reason may change', old.id;
  end if;

  return new;
end;
$$;

comment on function public.protect_invoice_facts() is
  'BEFORE UPDATE guard: rejects any change to an invoice''s financial/snapshot facts. Only payment_status, void_at, void_reason, and updated_at may ever change after issuance.';

create trigger invoices_protect_facts
before update on public.invoices
for each row execute function public.protect_invoice_facts();

create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

revoke all privileges
on table public.invoices
from anon, authenticated;

grant select, insert, update
on table public.invoices
to service_role;
revoke truncate, references, trigger
on public.invoices
from service_role;
-- No delete grant — an invoice is never removed, only voided in place.

-- ---------------------------------------------------------------------------
-- receipts — fully append-only, no update path at all (same convention as
-- financial_audit_log). Represents one settled payment event; later
-- refunds/disputes live on their own existing tables and are joined live
-- by the printable receipt page, never written back here.
-- ---------------------------------------------------------------------------

create table public.receipts (
  id uuid primary key default gen_random_uuid(),

  receipt_number text not null unique,
  invoice_id uuid not null references public.invoices (id),
  customer_id uuid not null references public.customers (id),

  source_type text not null check (source_type in ('visit_payment', 'cancellation_fee', 'prepaid_package')),
  service_visit_payment_id uuid references public.service_visit_payments (id),
  service_fee_assessment_id uuid references public.service_fee_assessments (id),
  prepaid_package_id uuid references public.prepaid_packages (id),

  payment_timestamp timestamptz not null,
  amount_paid numeric(10, 2) not null check (amount_paid >= 0),
  tax_paid numeric(10, 2) not null default 0 check (tax_paid >= 0),
  tip_paid numeric(10, 2) not null default 0 check (tip_paid >= 0),

  -- Safe display only — e.g. "Visa •••• 4242", "Zelle", "Cash", "Bank
  -- account (ACH)". Never a raw card number, CVC, bank credential, Stripe
  -- secret, or client_secret — see src/lib/invoicing/build-receipt-input.ts,
  -- the sole writer, which only ever passes already-sanitized display text.
  payment_method_display text not null,

  stripe_payment_intent_id text,
  stripe_charge_id text,

  currency text not null default 'usd',

  created_at timestamptz not null default now(),

  constraint receipts_source_type_reference_check check (
    (source_type = 'visit_payment' and service_visit_payment_id is not null and service_fee_assessment_id is null and prepaid_package_id is null)
    or (source_type = 'cancellation_fee' and service_fee_assessment_id is not null and service_visit_payment_id is null and prepaid_package_id is null)
    or (source_type = 'prepaid_package' and prepaid_package_id is not null and service_visit_payment_id is null and service_fee_assessment_id is null)
  )
);

comment on table public.receipts is
  'One row per settled payment event — fully immutable, no update grant at all. Never stores a raw card number/CVC/bank credential/Stripe secret/client_secret. Current refund/dispute status is joined live from service_visit_payments/prepaid_packages/stripe_disputes by the printable receipt page, never duplicated here. Issued once, atomically with its number, by issue_receipt().';

comment on column public.receipts.payment_method_display is
  'Sanitized display text only (e.g. "Visa •••• 4242", "Zelle", "Cash", "Bank account (ACH)") — never a raw card/bank number or Stripe secret.';

create index receipts_customer_id_idx on public.receipts (customer_id);
create index receipts_invoice_id_idx on public.receipts (invoice_id);
create index receipts_service_visit_payment_id_idx on public.receipts (service_visit_payment_id) where service_visit_payment_id is not null;

alter table public.receipts enable row level security;

revoke all privileges
on table public.receipts
from anon, authenticated;

grant select, insert
on table public.receipts
to service_role;
-- Deliberately no update or delete grant — genuinely append-only, enforced
-- at the DB privilege level (same convention as financial_audit_log), not
-- merely by application-code discipline. No revoke of truncate/references/
-- trigger needed since they were never granted to begin with (no bare
-- "grant all"/schema-level owner grant here).

revoke truncate, references, trigger
on public.receipts
from service_role;

-- ---------------------------------------------------------------------------
-- issue_invoice / issue_receipt — the sole writers. Each allocates its
-- document number and inserts its row inside one function invocation (one
-- transaction from the caller's perspective), so a number is never
-- allocated without the row that uses it actually being created in the
-- same commit.
-- ---------------------------------------------------------------------------

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
  p_discount_amount numeric,
  p_discount_description text,
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
    travel_amount, supplies_amount, discount_amount, discount_description,
    cancellation_fee_amount, tax_amount, subtotal_amount, total_amount,
    pricing_snapshot
  ) values (
    v_invoice_number, p_source_type, p_service_visit_id, p_prepaid_package_id,
    p_service_visit_pricing_id, p_service_fee_assessment_id, p_customer_id,
    p_customer_display_name, p_description,
    p_service_address_line1, p_service_address_line2, p_service_city, p_service_state, p_service_zip,
    p_service_date, p_cleaning_type, p_currency,
    p_base_amount, p_room_adjustments_amount, p_add_ons_amount, p_add_ons_detail,
    p_travel_amount, p_supplies_amount, p_discount_amount, p_discount_description,
    p_cancellation_fee_amount, p_tax_amount, p_subtotal_amount, p_total_amount,
    p_pricing_snapshot
  )
  returning * into v_invoice;

  return v_invoice;
end;
$$;

comment on function public.issue_invoice(text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text, numeric, numeric, numeric, jsonb, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, jsonb) is
  'Allocates the next CP-INV-YYYY-###### number and inserts the invoice row in one call. Sole caller: src/lib/invoicing/issue-invoice.ts.';

create or replace function public.issue_receipt(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_source_type text,
  p_service_visit_payment_id uuid,
  p_service_fee_assessment_id uuid,
  p_prepaid_package_id uuid,
  p_payment_timestamp timestamptz,
  p_amount_paid numeric,
  p_tax_paid numeric,
  p_tip_paid numeric,
  p_payment_method_display text,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_currency text
)
returns public.receipts
language plpgsql
set search_path = public
as $$
declare
  v_number bigint;
  v_receipt_number text;
  v_receipt receipts;
begin
  v_number := allocate_document_number('receipt', extract(year from now())::integer);
  v_receipt_number := 'CP-RCT-' || extract(year from now())::text || '-' || lpad(v_number::text, 6, '0');

  insert into receipts (
    receipt_number, invoice_id, customer_id, source_type,
    service_visit_payment_id, service_fee_assessment_id, prepaid_package_id,
    payment_timestamp, amount_paid, tax_paid, tip_paid,
    payment_method_display, stripe_payment_intent_id, stripe_charge_id, currency
  ) values (
    v_receipt_number, p_invoice_id, p_customer_id, p_source_type,
    p_service_visit_payment_id, p_service_fee_assessment_id, p_prepaid_package_id,
    p_payment_timestamp, p_amount_paid, p_tax_paid, p_tip_paid,
    p_payment_method_display, p_stripe_payment_intent_id, p_stripe_charge_id, p_currency
  )
  returning * into v_receipt;

  return v_receipt;
end;
$$;

comment on function public.issue_receipt(uuid, uuid, text, uuid, uuid, uuid, timestamptz, numeric, numeric, numeric, text, text, text, text) is
  'Allocates the next CP-RCT-YYYY-###### number and inserts the receipt row in one call. Sole caller: src/lib/invoicing/issue-receipt.ts.';

revoke all on function public.issue_invoice(text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text, numeric, numeric, numeric, jsonb, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, jsonb)
from public, anon, authenticated;
grant execute on function public.issue_invoice(text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text, numeric, numeric, numeric, jsonb, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, jsonb)
to service_role;

revoke all on function public.issue_receipt(uuid, uuid, text, uuid, uuid, uuid, timestamptz, numeric, numeric, numeric, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.issue_receipt(uuid, uuid, text, uuid, uuid, uuid, timestamptz, numeric, numeric, numeric, text, text, text, text)
to service_role;

-- ---------------------------------------------------------------------------
-- void_invoice_with_audit — the only mutation path for an already-issued
-- invoice. Owner-only in application code (assertCapability("financial_correction")
-- before this is ever reached, same trust boundary as every other
-- *_with_audit RPC in this schema — this function trusts p_actor_role as-is).
-- ---------------------------------------------------------------------------

create or replace function public.void_invoice_with_audit(
  p_invoice_id uuid,
  p_reason text,
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.invoices
language plpgsql
set search_path = public
as $$
declare
  v_invoice invoices;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;

  if v_invoice.id is null then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if v_invoice.payment_status = 'void' then
    return v_invoice; -- Idempotent no-op — already voided.
  end if;

  update invoices
  set payment_status = 'void', void_at = now(), void_reason = p_reason
  where id = p_invoice_id
  returning * into v_invoice;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type, target_entity_type, target_entity_id,
    service_visit_id, reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'invoice_voided', 'invoice', p_invoice_id,
    v_invoice.service_visit_id, p_reason, jsonb_build_object('invoiceNumber', v_invoice.invoice_number, 'totalAmount', v_invoice.total_amount)
  );

  return v_invoice;
end;
$$;

comment on function public.void_invoice_with_audit(uuid, text, uuid, text) is
  'Atomically voids an invoice and writes its financial_audit_log row in one transaction. Idempotent no-op if already void. Trusts p_actor_role as-is — application code must call assertCapability("financial_correction") before this is ever reached, same trust boundary as every other *_with_audit RPC in this schema.';

revoke all on function public.void_invoice_with_audit(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.void_invoice_with_audit(uuid, text, uuid, text) to service_role;
