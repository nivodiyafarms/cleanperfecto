-- ============================================================================
-- Migration: create customers table + shared updated_at trigger helper
-- Owner-approved 2026-08-17 (Production Quote Data Model v2/v3 design).
--
-- REVIEW ONLY — DO NOT APPLY YET.
-- Do not run `supabase db push` (or otherwise execute this file) until it
-- has been explicitly approved for application.
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger helper — sets updated_at = now() on any row change. Used by customers, quote_requests, and service_visits.';

create table public.customers (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  email text,
  email_normalized text,
  phone text,
  phone_normalized text, -- canonical US E.164, e.g. +14695551234

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Follow-up support — CURRENT STATE only. The future admin dashboard
  -- DERIVES overdue/follow-up status from service_visits + these fields at
  -- query time; no stale computed boolean is stored anywhere.
  last_follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  follow_up_notes text,

  constraint customers_contact_method_required
    check (email is not null or phone is not null)
);

comment on table public.customers is
  'One record per real-world customer identity. Source of truth for the future admin dashboard, service history, and follow-up tracking. Deliberately holds no address — each quote_requests/service_visits row snapshots its own service address; address is never duplicated here.';

comment on column public.customers.email_normalized is
  'Lowercased + trimmed, populated server-side only — never trust a client-supplied value. No UNIQUE constraint: see the approved resolveCustomer identity-conflict rule (matching email -> Customer A, matching phone -> Customer B must return an explicit manual-review outcome, never an automatic merge or arbitrary choice). Deduplication policy is intentionally not enforced at the DB level yet.';

comment on column public.customers.phone_normalized is
  'Canonical US E.164 (e.g. +14695551234), populated server-side only via a phone-normalization helper (10-digit -> prepend "1"; 11-digit leading "1" -> use as-is; anything else -> left null, never guessed). Never trust a client-supplied value.';

-- Non-unique — see column comments above. Indexes exist for lookup
-- performance only, not identity enforcement.
create index customers_email_normalized_idx
  on public.customers (email_normalized) where email_normalized is not null;
create index customers_phone_normalized_idx
  on public.customers (phone_normalized) where phone_normalized is not null;

alter table public.customers enable row level security;

revoke all privileges
on table public.customers
from anon, authenticated;

grant select, insert, update
on table public.customers
to service_role;
-- No delete grant — customer records are never destructively removed.

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();
