-- ============================================================================
-- Migration: create customer_notification_preferences
-- Notifications V1 milestone.
--
-- Smallest schema that supports V1: SMS is opt-in-by-default (TCPA) and
-- there is no consent/preference tracking anywhere in the schema to reuse.
-- Operational/transactional email (everything in service_visit_notifications)
-- remains enabled as part of servicing the booking and is NOT gated by this
-- table — no email_transactional_opt_out column here. Marketing/review/
-- promotional opt-out is explicitly deferred to the Consent + Review
-- Automation milestone.
-- ============================================================================

create table public.customer_notification_preferences (
  customer_id uuid primary key references public.customers (id),

  sms_opt_in boolean not null default false,
  sms_opt_in_at timestamptz,
  sms_opt_in_source text,
  sms_opt_out_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_notification_preferences is
  'Minimal per-customer notification preferences. Only field with real V1 behavior: sms_opt_in (default false — no SMS is ever sent without it). sms_opt_in_source is free text (e.g. "portal_profile") for audit trail. No email opt-out here: operational/transactional email is not gated by consent in V1 — see table comment history / architecture notes for why.';

comment on column public.customer_notification_preferences.sms_opt_in_source is
  'Free-text provenance of the opt-in (e.g. "portal_profile") — no generalized actor/channel-source enum exists yet, same convention as service_visit_pricing.confirmed_by.';

create trigger customer_notification_preferences_set_updated_at
before update on public.customer_notification_preferences
for each row execute function public.set_updated_at();

alter table public.customer_notification_preferences enable row level security;

revoke all privileges
on table public.customer_notification_preferences
from anon, authenticated;

grant select, insert, update
on table public.customer_notification_preferences
to service_role;
-- No delete grant — a preference is only ever toggled, never removed,
-- preserving opt-in/opt-out history via sms_opt_in_at/sms_opt_out_at.
