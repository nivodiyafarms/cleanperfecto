-- ============================================================================
-- Migration: create service_visits table
-- Owner-approved 2026-08-17 (Production Quote Data Model v2/v3 design).
--
-- REVIEW ONLY — DO NOT APPLY YET.
--
-- Authoritative source of actual cleaning/service history. Replaces the
-- earlier first_cleaning_redemptions proposal entirely — a completed row
-- here IS the qualifying-service fact; no parallel redemption table exists,
-- avoiding a second source of truth for the same real-world event.
--
-- Depends on public.customers and public.quote_requests, so this file must
-- apply after both prior migrations in this series.
-- ============================================================================

create table public.service_visits (
  id uuid primary key default gen_random_uuid(),

  customer_id uuid not null references public.customers (id),
  quote_request_id uuid references public.quote_requests (id), -- nullable: a visit may be scheduled directly, with no tracked quote

  visit_number integer check (visit_number is null or visit_number > 0), -- package sequencing; null for a one-time visit

  cleaning_type text
    check (cleaning_type is null or cleaning_type in ('standard', 'deep', 'move')),
  -- Snapshot of the service context for THIS visit — not a foreign key into
  -- quote_requests.frequency, deliberately. quote_request_id is nullable
  -- (an admin can create a visit directly), so a visit's own record must
  -- stay independently understandable without a join. This is not a
  -- recurring-plan table; it's just what this one visit's cadence was.
  frequency text
    check (
      frequency is null or frequency in (
        'one_time', 'weekly', 'biweekly', 'every_4_weeks'
      )
    ),

  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled')),

  -- A calendar date is sufficient for this milestone — no time-of-day/slot
  -- concept yet. Calendar/booking UI remains a later, separate build.
  scheduled_for date,
  completed_at timestamptz,
  cancelled_at timestamptz,

  -- Service-address snapshot — captured directly on this table (not merely
  -- inherited via quote_request_id) because:
  --   1. An admin may create a visit with no linked quote_request at all.
  --   2. A customer may move; each visit must preserve where THAT specific
  --      cleaning actually happened, independent of any later address.
  --   3. Address-based first-cleaning eligibility must work directly from
  --      service_visits, never merely via a joined quote_request.
  service_address_line1 text,
  service_address_line2 text, -- apartment/unit
  service_city text,
  service_state text,
  service_zip text,
  service_address_identity text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- No contradictory state: a visit's timestamps must agree with its own
  -- status, and it can never be simultaneously completed and cancelled.
  constraint service_visits_status_timestamps_consistent check (
    (status = 'scheduled' and completed_at is null and cancelled_at is null)
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
  )
);

comment on table public.service_visits is
  'Authoritative source of actual cleaning/service events. One customer has many visits; one quote_request can have many visits (a prepaid package). Drives last/next-cleaning derivation and first-cleaning eligibility — never quote_requests.status, which tracks quote/lead lifecycle only, not service completion.';

comment on column public.service_visits.cleaning_type is
  'Nullable by design: an admin backfilling historical service records may not always know the exact cleaning type performed. Populate it whenever the service is known — do not leave it unknown for new, forward-created visits.';

comment on column public.service_visits.service_address_identity is
  'Server-generated only (never client-supplied): ZIP5 + normalized street + normalized unit, using the same normalization helper as quote_requests.service_address_identity. Used directly (not merely via quote_request_id) for address-based first-cleaning eligibility, so eligibility checking works even for visits created with no linked quote.';

create index service_visits_customer_status_scheduled_idx
  on public.service_visits (customer_id, status, scheduled_for);
create index service_visits_customer_status_completed_idx
  on public.service_visits (customer_id, status, completed_at);
create index service_visits_quote_request_id_idx
  on public.service_visits (quote_request_id) where quote_request_id is not null;
create index service_visits_service_address_identity_idx
  on public.service_visits (service_address_identity) where service_address_identity is not null;

alter table public.service_visits enable row level security;

revoke all privileges
on table public.service_visits
from anon, authenticated;

grant select, insert, update
on table public.service_visits
to service_role;
-- No delete grant — a cancelled visit is a status, not a deletion; history is preserved.

create trigger service_visits_set_updated_at
before update on public.service_visits
for each row execute function public.set_updated_at();
