-- ============================================================================
-- Migration: create agreed_quote_invitation_sends table
-- Admin-Created Agreed-Quote Onboarding Invitation feature.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- The send-ledger row sendNotificationEmailWithRetry needs to call
-- markSent/markFailedTerminal against — mirrors service_visit_notifications'
-- minimal shape (see 20260822091300's migration). Rows are inserted already
-- in 'sending' state by claim_agreed_quote_invitation_send (see that
-- function's own migration) so a row is never eligible for any generic
-- cron dispatcher to also pick up.
--
-- Depends on public.agreed_quote_invitations.
-- ============================================================================

create table public.agreed_quote_invitation_sends (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.agreed_quote_invitations (id),
  idempotency_key text not null unique,
  status text not null check (status in ('sending', 'sent', 'failed_terminal')),
  failure_reason text,
  created_at timestamptz not null default now()
);

comment on table public.agreed_quote_invitation_sends is
  'Append-only send ledger for agreed-quote-invitation emails (first send, resend, and renew-send all use the same claim/send path) — see claim_agreed_quote_invitation_send() and sendAgreedQuoteInvitation.';

create index agreed_quote_invitation_sends_invitation_id_idx
  on public.agreed_quote_invitation_sends (invitation_id, created_at desc);

alter table public.agreed_quote_invitation_sends enable row level security;

revoke all privileges
on table public.agreed_quote_invitation_sends
from anon, authenticated;

grant select, insert, update
on table public.agreed_quote_invitation_sends
to service_role;
-- No delete grant — same append-only convention as service_visit_notifications.
