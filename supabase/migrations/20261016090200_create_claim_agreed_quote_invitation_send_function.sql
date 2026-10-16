-- ============================================================================
-- Migration: claim_agreed_quote_invitation_send — atomic claim for the
-- agreed-quote-invitation email send path (first send, resend, and renew
-- all share this one function).
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Same advisory-lock-then-count convention as claim_payment_link_resend and
-- claim_customer_login_link_request (see those migrations' own comments):
-- an advisory transaction lock keyed to the invitation id serializes
-- concurrent send/resend attempts for the SAME invitation (never blocking
-- unrelated invitations against each other), the cooldown/rate-limit check
-- and the ledger INSERT happen inside that same locked transaction (no
-- separate read-then-write TOCTOU window), and the row is inserted ALREADY
-- in 'sending' state.
--
-- Simpler than claim_payment_link_resend: there is no separate "original
-- automated send" vs "resend" distinction here (sendAgreedQuoteInvitation is
-- the single function used for the first send and every resend/renew), so
-- every prior send attempt for this invitation counts toward cooldown/rate
-- limit uniformly.
--
-- Raises a plain exception with message 'duplicate_request' or
-- 'rate_limited' when blocked — same convention as every other
-- business-rule rejection in this schema.
-- ============================================================================

create or replace function public.claim_agreed_quote_invitation_send(
  p_invitation_id uuid,
  p_idempotency_key text,
  p_now timestamptz,
  p_cooldown_seconds integer,
  p_rate_limit_window_seconds integer,
  p_rate_limit_max integer
)
returns public.agreed_quote_invitation_sends
language plpgsql
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_most_recent timestamptz;
  v_recent_count integer;
  v_row agreed_quote_invitation_sends;
begin
  v_lock_key := ('x' || substr(md5(p_invitation_id::text), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select max(created_at) into v_most_recent
  from agreed_quote_invitation_sends
  where invitation_id = p_invitation_id;

  if v_most_recent is not null and p_now - v_most_recent < make_interval(secs => p_cooldown_seconds) then
    raise exception 'duplicate_request';
  end if;

  select count(*) into v_recent_count
  from agreed_quote_invitation_sends
  where invitation_id = p_invitation_id
    and created_at > p_now - make_interval(secs => p_rate_limit_window_seconds);

  if v_recent_count >= p_rate_limit_max then
    raise exception 'rate_limited';
  end if;

  insert into agreed_quote_invitation_sends (invitation_id, idempotency_key, status)
  values (p_invitation_id, p_idempotency_key, 'sending')
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.claim_agreed_quote_invitation_send(uuid, text, timestamptz, integer, integer, integer) is
  'Atomically enforces duplicate/rate-limit protection AND inserts the send ledger row already in ''sending'' state in one advisory-locked transaction. Raises ''duplicate_request''/''rate_limited'' when blocked. Sole caller: sendAgreedQuoteInvitation (src/lib/instant-quote/send-agreed-quote-invitation.ts), used for the first send, every resend, and every renew-send.';

revoke all on function public.claim_agreed_quote_invitation_send(uuid, text, timestamptz, integer, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_agreed_quote_invitation_send(uuid, text, timestamptz, integer, integer, integer)
to service_role;
