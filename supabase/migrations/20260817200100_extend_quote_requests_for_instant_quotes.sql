-- ============================================================================
-- Migration: extend quote_requests for the instant pricing-engine quote flow
-- Owner-approved 2026-08-17 (Production Quote Data Model v2/v3 design).
--
-- REVIEW ONLY — DO NOT APPLY YET.
--
-- Purely additive except:
--   - email/phone: NOT NULL -> nullable (both), with a new combined CHECK
--     requiring at least one. The public QuoteForm's behavior is UNCHANGED —
--     its own server-action validation (submitQuoteRequest.ts) still
--     requires both; only the DB itself becomes more permissive, for future
--     phone/text/admin-created leads.
--   - property_type / status CHECK constraints: widened only — every value
--     any existing row can hold today remains valid. This file was authored
--     without live database access, so the constraint names below are
--     discovered dynamically at apply time (see the DO blocks in sections 5
--     and 6) rather than assumed. Before applying, confirm against the live
--     schema that exactly one CHECK constraint on public.quote_requests
--     mentions property_type, and exactly one mentions both status and spam
--     — each DO block looks this up with `select ... into strict` and
--     requires exactly one match, raising a clear exception and aborting
--     the migration on either zero matches or more than one, rather than
--     silently continuing or guessing. A failed apply here is the signal to
--     investigate the live schema, not a bug to work around.
--   - a BEFORE UPDATE trigger is added that freezes pricing_snapshot and its
--     denormalized scalar columns once pricing_snapshot is populated (see
--     section 13 below) — protection added ahead of any future UPDATE
--     grant, not a behavior change to what's possible today.
-- No existing row is invalidated by anything in this file.
--
-- Depends on public.customers (customer_id FK in section 2, and the shared
-- public.set_updated_at() trigger function in section 12), so this file must
-- apply after 20260817200000_create_customers.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Contact nullability — at least one of email/phone is still required.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  alter column email drop not null,
  alter column phone drop not null;

alter table public.quote_requests
  add constraint quote_requests_contact_method_required
  check (email is not null or phone is not null);

-- ---------------------------------------------------------------------------
-- 2. customers link — nullable; existing rows and the current QuoteForm
--    need no change. Resolved by future server-side logic.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column customer_id uuid references public.customers (id);

create index quote_requests_customer_id_idx
  on public.quote_requests (customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 3. entry_channel — HOW the record entered CleanPerfecto. Defaults to
--    'website' so every existing row and the current QuoteForm are
--    automatically and correctly classified with zero code change.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column entry_channel text not null default 'website'
    check (entry_channel in ('website', 'phone', 'text', 'admin'));

-- ---------------------------------------------------------------------------
-- 4. lead_source — HOW the customer discovered CleanPerfecto. Distinct from
--    entry_channel. Not wired into the current public QuoteForm yet.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column lead_source text
    check (
      lead_source is null or lead_source in (
        'google', 'facebook_instagram', 'referral',
        'apartment_flyer_business_card', 'returning_customer', 'other'
      )
    ),
  add column lead_source_detail text;

-- ---------------------------------------------------------------------------
-- 5. property_type — add 'apartment' as its own distinct value (never
--    collapsed into 'home'). 'restaurant' and 'office' remain distinct from
--    each other too — only the pricing engine's internal PropertyKind maps
--    both to "commercial", inside pricing_snapshot, never at this column.
--
--    Constraint name discovered dynamically rather than assumed, since this
--    file was authored without live database access. The lookup below uses
--    `select ... into strict` and requires exactly one match: zero matches
--    (no_data_found) or more than one (too_many_rows) both abort the
--    migration with a clear exception rather than silently continuing or
--    guessing which constraint to drop. If either exception fires, stop and
--    inspect pg_constraint by hand rather than re-running.
-- ---------------------------------------------------------------------------
do $$
declare
  existing_constraint text;
begin
  select con.conname into strict existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'quote_requests'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%property_type%';

  execute format('alter table public.quote_requests drop constraint %I', existing_constraint);
exception
  when no_data_found then
    raise exception
      'Expected exactly one property_type CHECK constraint on public.quote_requests, found none. The live schema has drifted from this migration''s assumptions — resolve manually before applying.';
  when too_many_rows then
    raise exception
      'Expected exactly one property_type CHECK constraint on public.quote_requests, found multiple. The live schema has drifted from this migration''s assumptions — resolve manually before applying.';
end $$;

alter table public.quote_requests
  add constraint quote_requests_property_type_check
  check (property_type in ('home', 'apartment', 'airbnb', 'restaurant', 'office'));

-- ---------------------------------------------------------------------------
-- 6. status — add 'cancelled' (a quote/lead being withdrawn is a
--    quote-lifecycle event, distinct from a booked service later being
--    cancelled, which is service_visits.status = 'cancelled'). 'completed'
--    is intentionally NOT added here — service completion now lives
--    exclusively in service_visits.status, so the same real-world event is
--    never tracked in two places. 'closed' is kept only for backward
--    compatibility with any existing rows; new rows should use 'cancelled'.
-- ---------------------------------------------------------------------------
do $$
declare
  existing_constraint text;
begin
  select con.conname into strict existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'quote_requests'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%'
    and pg_get_constraintdef(con.oid) ilike '%spam%'; -- disambiguates from any other constraint that happens to mention "status"

  execute format('alter table public.quote_requests drop constraint %I', existing_constraint);
exception
  when no_data_found then
    raise exception
      'Expected exactly one status CHECK constraint containing spam on public.quote_requests, found none. The live schema has drifted from this migration''s assumptions — resolve manually before applying.';
  when too_many_rows then
    raise exception
      'Expected exactly one status CHECK constraint containing spam on public.quote_requests, found multiple. The live schema has drifted from this migration''s assumptions — resolve manually before applying.';
end $$;

alter table public.quote_requests
  add constraint quote_requests_status_check
  check (status in ('new', 'contacted', 'quoted', 'booked', 'cancelled', 'closed', 'spam'));

comment on column public.quote_requests.status is
  'Quote/lead lifecycle only — NOT service completion (see service_visits.status). ''new'' = inquiry. ''closed'' is legacy/deprecated; use ''cancelled'' for new rows.';

-- ---------------------------------------------------------------------------
-- 7. Cleaning type / frequency / package terms — splits what the legacy
--    service_id column conflates. service_id is left untouched.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column cleaning_type text
    check (cleaning_type is null or cleaning_type in ('standard', 'deep', 'move')),
  add column frequency text
    check (frequency is null or frequency in ('one_time', 'weekly', 'biweekly', 'every_4_weeks')),
  add column is_prepaid_package boolean not null default false,
  add column visit_count integer
    check (visit_count is null or visit_count > 0);

-- ---------------------------------------------------------------------------
-- 8. Property/room/condition details.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column bedrooms smallint check (bedrooms is null or bedrooms >= 0),
  add column full_bathrooms smallint check (full_bathrooms is null or full_bathrooms >= 0),
  add column half_bathrooms smallint check (half_bathrooms is null or half_bathrooms >= 0),
  add column square_feet integer check (square_feet is null or square_feet > 0),
  add column condition text
    check (condition is null or condition in ('light', 'moderate', 'heavy', 'extensive'));

-- ---------------------------------------------------------------------------
-- 9. Full service address + server-generated normalized identity. `zip`
--    (existing, still NOT NULL) is unchanged and continues to serve as the
--    service ZIP.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column service_address_line1 text,
  add column service_address_line2 text, -- apartment/unit
  add column service_city text,
  add column service_state text,
  add column service_address_identity text;

comment on column public.quote_requests.service_address_identity is
  'Server-generated only (never client-supplied): ZIP5 + normalized street + normalized unit. Unit is always included — never derived from ZIP alone. Uses the same normalization helper as service_visits.service_address_identity.';

create index quote_requests_service_address_identity_idx
  on public.quote_requests (service_address_identity)
  where service_address_identity is not null;

-- ---------------------------------------------------------------------------
-- 10. Normalized contact identity — server-generated only, never trusted
--     from the client.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column email_normalized text,
  add column phone_normalized text; -- canonical US E.164

create index quote_requests_email_normalized_idx
  on public.quote_requests (email_normalized) where email_normalized is not null;
create index quote_requests_phone_normalized_idx
  on public.quote_requests (phone_normalized) where phone_normalized is not null;

-- ---------------------------------------------------------------------------
-- 11. Pricing outcome — searchable scalars, denormalized from
--     pricing_snapshot purely for fast admin filtering/reporting.
--     pricing_snapshot remains the sole authoritative source.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column estimate_type text
    check (estimate_type is null or estimate_type in ('instant_range', 'manual_review')),
  add column pricing_version text,
  add column calculated_total numeric(10, 2),
  add column display_range_lower numeric(10, 2),
  add column display_range_upper numeric(10, 2),
  add column prepaid_package_total numeric(10, 2),
  add column effective_price_per_visit numeric(10, 2),
  add column has_starting_at_pricing boolean,
  add column manual_review_reasons text[],
  add column first_cleaning_offer_applied boolean;

comment on column public.quote_requests.first_cleaning_offer_applied is
  'Audit information only: whether THIS quote''s own calculation applied the first-cleaning discount. Never an eligibility source of truth — eligibility is determined solely from completed service_visits (see that table''s comments), never from this flag and never from quote_requests existence alone.';

alter table public.quote_requests
  add column pricing_snapshot jsonb;

comment on column public.quote_requests.pricing_snapshot is
  'Immutable { input: CalculationInput, result: CalculationResult } captured at submission time. Never re-derived from live pricing config; source of truth for every pricing line item (base price, room/sqft/condition adjustments, travel, supplies, add-ons, discounts, $99-floor status, package totals, etc).';

-- ---------------------------------------------------------------------------
-- 12. updated_at — the original table never had one; needed now that
--     status/customer_id become mutable over a quote's lifecycle.
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column updated_at timestamptz not null default now();

create trigger quote_requests_set_updated_at
before update on public.quote_requests
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 13. Pricing snapshot immutability. pricing_snapshot is the historical
--     record of what the customer was actually quoted. Today service_role
--     only has INSERT on this table, so nothing can update it yet — but a
--     future admin dashboard WILL need UPDATE (status, customer_id,
--     follow-up/workflow fields), and when that grant is added, pricing
--     data must not accidentally become mutable along with it. This guard
--     is added now, ahead of that grant, so the protection already exists
--     the moment UPDATE becomes possible.
--
--     Once pricing_snapshot is non-null, every pricing-derived field is
--     frozen; a revised quote must create a NEW historical quote/snapshot
--     rather than silently rewriting this one. Workflow fields (status,
--     customer_id, updated_at, entry_channel, lead_source, etc.) are
--     unaffected and remain freely updateable. Does not run on INSERT, and
--     does not block a row created with pricing_snapshot NULL (e.g. by the
--     legacy QuoteForm) from later receiving its first snapshot, if that
--     workflow is explicitly supported later.
-- ---------------------------------------------------------------------------
create or replace function public.protect_quote_pricing_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.pricing_snapshot is not null then
    if new.pricing_snapshot is distinct from old.pricing_snapshot
      or new.pricing_version is distinct from old.pricing_version
      or new.calculated_total is distinct from old.calculated_total
      or new.display_range_lower is distinct from old.display_range_lower
      or new.display_range_upper is distinct from old.display_range_upper
      or new.prepaid_package_total is distinct from old.prepaid_package_total
      or new.effective_price_per_visit is distinct from old.effective_price_per_visit
      or new.has_starting_at_pricing is distinct from old.has_starting_at_pricing
      or new.manual_review_reasons is distinct from old.manual_review_reasons
      or new.first_cleaning_offer_applied is distinct from old.first_cleaning_offer_applied
      or new.estimate_type is distinct from old.estimate_type
    then
      raise exception
        'quote_requests pricing fields are immutable once pricing_snapshot is set (id=%). Create a new quote/snapshot instead of modifying a historical one.',
        old.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_quote_pricing_snapshot() is
  'BEFORE UPDATE guard: once pricing_snapshot is non-null, rejects any change to it or the denormalized pricing scalar columns (pricing_version, calculated_total, display_range_lower/upper, prepaid_package_total, effective_price_per_visit, has_starting_at_pricing, manual_review_reasons, first_cleaning_offer_applied, estimate_type). Workflow fields (status, customer_id, updated_at, etc.) remain freely updateable. Never fires on INSERT; never blocks the first snapshot being set on a row created with pricing_snapshot NULL.';

create trigger quote_requests_protect_pricing_snapshot
before update on public.quote_requests
for each row execute function public.protect_quote_pricing_snapshot();

-- ---------------------------------------------------------------------------
-- 14. Grants — UNCHANGED. This migration only adds columns; service_role's
--     existing INSERT-only grant already covers inserting the new columns.
--     SELECT/UPDATE for a future admin dashboard is a deliberate, separate
--     decision NOT bundled into this schema migration — the pricing-
--     immutability trigger above exists precisely so that future grant is
--     safe to add without risking historical pricing data.
-- ---------------------------------------------------------------------------
