-- ============================================================================
-- Migration: fix claim_agreed_quote_invitation_checkout/_cancellation to
-- return SETOF, not a bare composite.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- BUG FOUND DURING PREVIEW SMOKE TESTING (not caught by any unit test,
-- since those exercise TypeScript fakes, not real Postgres function-return
-- semantics): a `language sql` function declared `RETURNS
-- public.agreed_quote_invitations` (a bare composite, not SETOF) that ends
-- in an UPDATE ... RETURNING which matches ZERO rows does NOT return zero
-- rows when called via `SELECT * FROM fn(...)` — Postgres returns exactly
-- ONE row with every column NULL. Confirmed directly against Preview:
-- `select count(*) from claim_agreed_quote_invitation_checkout(<refused
-- claim args>)` returned 1, not 0. Through PostgREST, `.rpc(...).maybeSingle()`
-- would receive a non-null JS object with every field null — a refused
-- claim (wrong customer, wrong status, expired) would be indistinguishable
-- from a real row and the application's `data ? toInvitationRow(data) :
-- null` check would wrongly treat it as a successful claim.
--
-- Fix: redeclare both functions RETURNS SETOF public.agreed_quote_invitations.
-- A SETOF function correctly propagates the real row count (0 or 1, since
-- the UPDATE is always scoped to a single primary-key id) from its final
-- query — `.maybeSingle()` remains the correct client-side call, now with
-- correct zero-row semantics. Postgres requires DROP + CREATE (not plain
-- CREATE OR REPLACE) to change a function's declared return type.
-- ============================================================================

drop function if exists public.claim_agreed_quote_invitation_checkout(uuid, uuid, timestamptz);

create function public.claim_agreed_quote_invitation_checkout(
  p_invitation_id uuid,
  p_customer_id uuid,
  p_now timestamptz
)
returns setof public.agreed_quote_invitations
language sql
set search_path = public
as $$
  update agreed_quote_invitations aqi
  set status = 'checkout_in_progress',
      checkout_started_at = coalesce(aqi.checkout_started_at, p_now),
      updated_at = p_now
  where aqi.id = p_invitation_id
    and aqi.customer_id = p_customer_id
    and aqi.status in ('sent', 'checkout_in_progress')
    and (
      exists (
        select 1 from payment_attempts
        where payment_attempts.booking_order_id = aqi.booking_order_id
          and payment_attempts.status not in ('expired', 'canceled', 'failed')
      )
      or aqi.expires_at > p_now
    )
  returning aqi.*;
$$;

comment on function public.claim_agreed_quote_invitation_checkout(uuid, uuid, timestamptz) is
  'Atomic claim for createAgreedQuoteBookingCheckout: validates ownership (customer_id), status, and — ONLY when no live payment_attempts row exists for the invitation''s booking order — the offer''s own expires_at, all inside one UPDATE. Resuming a genuinely live Stripe attempt always bypasses the expiry check. SETOF so a refused claim genuinely returns zero rows (never a single all-NULL row) — see this migration''s own header comment for the bug this fixes.';

revoke all on function public.claim_agreed_quote_invitation_checkout(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.claim_agreed_quote_invitation_checkout(uuid, uuid, timestamptz)
to service_role;

drop function if exists public.claim_agreed_quote_invitation_cancellation(uuid, uuid, timestamptz);

create function public.claim_agreed_quote_invitation_cancellation(
  p_invitation_id uuid,
  p_admin_user_id uuid,
  p_now timestamptz
)
returns setof public.agreed_quote_invitations
language sql
set search_path = public
as $$
  update agreed_quote_invitations aqi
  set status = 'cancelled',
      cancelled_at = p_now,
      cancelled_by_admin_user_id = p_admin_user_id,
      updated_at = p_now
  where aqi.id = p_invitation_id
    and aqi.status in ('pending_send', 'sent', 'checkout_in_progress')
    and not exists (
      select 1 from payment_attempts
      where payment_attempts.booking_order_id = aqi.booking_order_id
        and payment_attempts.status not in ('expired', 'canceled', 'failed')
    )
  returning aqi.*;
$$;

comment on function public.claim_agreed_quote_invitation_cancellation(uuid, uuid, timestamptz) is
  'Atomic cancellation claim: refuses while a live (non-terminal) payment_attempts row exists for the invitation''s booking order, folded into the same UPDATE as the status flip so a concurrent customer retry can never create a live session in the gap between checking and cancelling. Vacuously allowed when booking_order_id IS NULL. SETOF so a refused cancellation genuinely returns zero rows — see claim_agreed_quote_invitation_checkout''s sibling fix in this same migration for the bug this addresses.';

revoke all on function public.claim_agreed_quote_invitation_cancellation(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.claim_agreed_quote_invitation_cancellation(uuid, uuid, timestamptz)
to service_role;
