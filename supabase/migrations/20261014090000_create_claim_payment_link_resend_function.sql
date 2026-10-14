-- ============================================================================
-- Migration: claim_payment_link_resend — atomic claim for the immediate
-- (non-cron) Final Total payment-link resend path.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- requestFreshPaymentLink (src/lib/customer-portal/request-fresh-payment-link.ts)
-- sends a Final Total one-click link SYNCHRONOUSLY, not via the
-- dispatch-notifications cron — but it writes into the SAME
-- service_visit_notifications table every notification uses, for the same
-- durable audit ledger. Two correctness problems exist if that write is
-- just a plain client-side INSERT:
--
--   1. The row is briefly 'pending' and due-now — exactly what
--      claim_due_service_visit_notifications (see
--      20260826090000_extend_service_visit_notifications_for_notifications_v1.sql)
--      looks for. If the cron's claim query runs in that window, it can
--      legitimately claim the SAME row and send a genuine second, separate
--      email for the same resend request.
--   2. A "read prior attempts, then decide whether to insert" duplicate/
--      rate-limit check, done as two separate client round-trips, is a
--      classic TOCTOU race: two concurrent resend requests (an admin click
--      and a customer click, or a double-click) can both read "0 recent
--      attempts" before either has inserted, and both proceed — duplicate
--      protection and rate limiting silently bypassed exactly when
--      concurrency makes them matter most.
--
-- This function closes BOTH problems in one atomic transaction, mirroring
-- claim_due_service_visit_notifications' own FOR UPDATE SKIP LOCKED
-- convention rather than inventing a different pattern:
--   - An advisory transaction lock keyed to the visit id serializes
--     concurrent callers for the SAME visit (never blocking unrelated
--     visits' resend requests against each other) — held only for the
--     duration of this one transaction, released automatically, no
--     separate unlock/cleanup needed.
--   - The cooldown/rate-limit check and the INSERT happen inside that same
--     locked transaction, so no second caller can read a state that's
--     about to become stale.
--   - The row is inserted ALREADY in 'sending' state (never 'pending' at
--     all) — it is categorically never eligible for
--     claim_due_service_visit_notifications to pick up, by construction,
--     not by a race that merely shrinks a window to "usually fine."
--
-- Only counts PRIOR RESEND attempts (idempotency_key containing ':resend:')
-- toward cooldown/rate-limit — never the original automated Finalize & Send,
-- which is a different, unrelated call with its own idempotency key shape.
-- Duplicate/rate-limit protection exists to catch a resend being requested
-- repeatedly, not to restrict how soon after the original send a first
-- resend may happen.
--
-- Raises a plain exception with message 'duplicate_request' or
-- 'rate_limited' when blocked — same convention as every other
-- business-rule rejection in this schema (add_custom_pricing_adjustment_with_audit,
-- etc.): the calling application code matches on error.message, never a
-- parsed SQLSTATE.
-- ============================================================================

create or replace function public.claim_payment_link_resend(
  p_service_visit_id uuid,
  p_customer_id uuid,
  p_idempotency_key text,
  p_now timestamptz,
  p_cooldown_seconds integer,
  p_rate_limit_window_seconds integer,
  p_rate_limit_max integer
)
returns public.service_visit_notifications
language plpgsql
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_most_recent timestamptz;
  v_recent_count integer;
  v_row service_visit_notifications;
begin
  v_lock_key := ('x' || substr(md5(p_service_visit_id::text), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select max(scheduled_send_at) into v_most_recent
  from service_visit_notifications
  where service_visit_id = p_service_visit_id
    and notification_type = 'final_total_ready'
    and idempotency_key like '%:resend:%';

  if v_most_recent is not null and p_now - v_most_recent < make_interval(secs => p_cooldown_seconds) then
    raise exception 'duplicate_request';
  end if;

  select count(*) into v_recent_count
  from service_visit_notifications
  where service_visit_id = p_service_visit_id
    and notification_type = 'final_total_ready'
    and idempotency_key like '%:resend:%'
    and scheduled_send_at > p_now - make_interval(secs => p_rate_limit_window_seconds);

  if v_recent_count >= p_rate_limit_max then
    raise exception 'rate_limited';
  end if;

  insert into service_visit_notifications (
    service_visit_id, customer_id, notification_type, channel, scheduled_send_at, idempotency_key, state, claimed_at
  ) values (
    p_service_visit_id, p_customer_id, 'final_total_ready', 'email', p_now, p_idempotency_key, 'sending', p_now
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.claim_payment_link_resend(uuid, uuid, text, timestamptz, integer, integer, integer) is
  'Atomically enforces duplicate/rate-limit protection AND inserts the resend ledger row already in ''sending'' state (never ''pending'') in one advisory-locked transaction — the row is categorically ineligible for claim_due_service_visit_notifications to also pick up. Raises a plain ''duplicate_request''/''rate_limited'' exception when blocked. Sole caller: requestFreshPaymentLink (src/lib/customer-portal/request-fresh-payment-link.ts), which still resolves the row via the existing markServiceVisitNotificationSent/FailedTerminal (unchanged — both already accept a prior state of ''sending'').';

revoke all on function public.claim_payment_link_resend(uuid, uuid, text, timestamptz, integer, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_payment_link_resend(uuid, uuid, text, timestamptz, integer, integer, integer)
to service_role;
