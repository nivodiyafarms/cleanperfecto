-- ============================================================================
-- Migration: create stripe_webhook_events table
-- Booking + Payment Phase 1 (owner-approved).
--
-- Idempotency ledger for Stripe webhook deliveries, WITH an explicit
-- processing state machine — not merely a "have we seen this event id"
-- unique-key check. Existence of a row is not proof that fulfillment
-- completed: a crash between recording receipt and finishing fulfillment
-- must not permanently skip that Stripe retry. Only a row that reaches
-- 'processed' is a safe, permanent no-op on redelivery; 'received' or
-- 'failed' rows are reprocessed. See webhook/claim-webhook-event.ts.
-- ============================================================================

create table public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),

  stripe_event_id text not null unique,
  event_type text not null,

  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed')),

  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text,

  payload jsonb not null
);

comment on table public.stripe_webhook_events is
  'Append-and-update idempotency ledger for Stripe webhook deliveries. A row reaching processing_status=processed is the only safe permanent no-op; received/failed rows are retried on redelivery, not skipped. Domain-level idempotency (unique constraints on prepaid_packages.booking_order_id and payment_attempts.stripe_checkout_session_id) is kept independent of this ledger as a second line of defense.';

comment on column public.stripe_webhook_events.failure_reason is
  'Set when processing_status=failed — the caught error message, for operator diagnosis. Never a place to store secrets; Stripe event payloads do not contain API keys.';

create index stripe_webhook_events_processing_status_idx
  on public.stripe_webhook_events (processing_status);

alter table public.stripe_webhook_events enable row level security;

revoke all privileges
on table public.stripe_webhook_events
from anon, authenticated;

grant select, insert, update
on table public.stripe_webhook_events
to service_role;
-- No delete grant — this is a permanent audit ledger.
