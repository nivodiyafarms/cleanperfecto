-- ============================================================================
-- Migration: create agreed_quote_invitations table
-- Admin-Created Agreed-Quote Onboarding Invitation feature.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- One row per quote_requests row created via the admin "Create & Send Agreed
-- Quote" flow (entry_channel = 'admin') — tracks the invitation's own
-- lifecycle (pending_send -> sent -> checkout_in_progress -> completed, or
-- cancelled/superseded) separately from the immutable quote/booking pricing
-- snapshots those rows already carry. Duplicate prevention is per-quote
-- (quote_request_id unique below), not per-customer — a customer may have
-- multiple simultaneous live invitations for separate deals.
--
-- Depends on public.quote_requests, public.customers, public.admin_users,
-- public.booking_orders.
-- ============================================================================

create table public.agreed_quote_invitations (
  id uuid primary key default gen_random_uuid(),

  quote_request_id uuid not null unique references public.quote_requests (id),
  customer_id uuid not null references public.customers (id),
  created_by_admin_user_id uuid not null references public.admin_users (id),

  status text not null default 'pending_send'
    check (status in ('pending_send', 'sent', 'checkout_in_progress', 'completed', 'cancelled', 'superseded')),

  -- Generated once at creation, reused as booking_orders.client_request_id
  -- for every checkout-creation/resume attempt tied to this invitation —
  -- never regenerated, even across resend/renew. This is what guarantees
  -- exactly one booking_orders row ever exists per invitation, by
  -- construction, via the existing client_request_id-unique idempotency
  -- booking_orders already has (see create-agreed-quote-booking-checkout.ts).
  client_request_id text not null unique,

  negotiation_channel text
    check (negotiation_channel is null or negotiation_channel in ('facebook', 'marketplace', 'phone', 'text', 'email', 'other')),
  negotiation_notes text,

  -- Optional admin-entered pre-agreed appointment. Still only ever a
  -- REQUEST (service_visits always start 'requested' regardless of source —
  -- admin confirmation is a separate, later, existing step) — never implies
  -- a confirmed appointment. Null when the admin didn't capture one, in
  -- which case the customer picks a date/time on the acceptance screen.
  agreed_requested_date date,
  agreed_requested_start_time text,

  resend_count integer not null default 0,
  last_sent_at timestamptz,
  expires_at timestamptz not null,

  renew_count integer not null default 0,
  renewed_at timestamptz,
  renewed_by_admin_user_id uuid references public.admin_users (id),

  -- Set on the NEW row when a revision replaces an old one; the OLD row
  -- gets superseded_at set instead (see createAgreedQuote's revise path).
  supersedes_invitation_id uuid references public.agreed_quote_invitations (id),
  superseded_at timestamptz,

  -- Set once, when checkout begins (not when it finishes) — the
  -- booking_order_id unique constraint below is a DB-level backstop
  -- guaranteeing no two invitations can ever reference the same booking
  -- order, on top of the 1:1 quote_request_id above.
  booking_order_id uuid unique references public.booking_orders (id),
  checkout_started_at timestamptz,

  -- Set only once the Stripe webhook confirms a successful payment-method
  -- setup or prepaid payment — never set merely because the customer
  -- clicked "Accept & Continue". See the webhook completion hook in
  -- process-stripe-webhook-event.ts.
  completed_at timestamptz,

  cancelled_at timestamptz,
  cancelled_by_admin_user_id uuid references public.admin_users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agreed_quote_invitations is
  'Lifecycle tracking for an admin-created agreed-quote onboarding invitation, 1:1 with the quote_requests row it was built from (entry_channel=''admin''). Terminal states: completed (webhook-confirmed), cancelled (admin), superseded (replaced by a revision). client_request_id is reused for every checkout attempt tied to this invitation, guaranteeing exactly one booking_orders row per invitation.';

comment on column public.agreed_quote_invitations.client_request_id is
  'Generated once at invitation creation, never regenerated. Reused as booking_orders.client_request_id for every checkout-creation/resume attempt, so booking_orders'' own unique-constraint idempotency guarantees exactly one booking order per invitation regardless of retries or concurrency.';

comment on column public.agreed_quote_invitations.expires_at is
  'Business validity deadline for the OFFER itself. Only ever gates creating a brand-new Stripe Checkout Session (claim_agreed_quote_invitation_checkout) — never retroactively invalidates an already-open session, which is left to run to its own natural conclusion (success or Stripe-side session expiry).';

create index agreed_quote_invitations_customer_id_idx
  on public.agreed_quote_invitations (customer_id);
create index agreed_quote_invitations_status_idx
  on public.agreed_quote_invitations (status);
create index agreed_quote_invitations_created_by_admin_user_id_idx
  on public.agreed_quote_invitations (created_by_admin_user_id);

create trigger agreed_quote_invitations_set_updated_at
before update on public.agreed_quote_invitations
for each row execute function public.set_updated_at();

alter table public.agreed_quote_invitations enable row level security;

revoke all privileges
on table public.agreed_quote_invitations
from anon, authenticated;

grant select, insert, update
on table public.agreed_quote_invitations
to service_role;
-- No delete grant — cancelled/superseded is a status, not a deletion.
