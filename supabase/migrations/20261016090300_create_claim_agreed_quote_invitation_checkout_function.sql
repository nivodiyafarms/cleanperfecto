-- ============================================================================
-- Migration: claim_agreed_quote_invitation_checkout — atomic claim for a
-- customer's "Accept & Continue" on an agreed-quote invitation.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Ownership, status, and the resume-vs-new-session expiry rule are all
-- inside this single UPDATE ... WHERE — no gap between "check" and "claim"
-- for a concurrent request to slip through.
--
-- The offer's own expires_at deadline ONLY ever gates creating a brand-new
-- Stripe Checkout Session — it never retroactively invalidates a checkout
-- that has already begun. Resuming a genuinely live (non-terminal)
-- payment_attempts row for this invitation's booking order always bypasses
-- the expiry check entirely (Stripe's own session lifecycle is authoritative
-- once a real session exists); only when no live attempt exists (no
-- session yet, or the only prior one is terminal) does this claim require
-- the offer to still be valid — uniformly for a first-ever claim and for a
-- retry after an interrupted earlier attempt that never reached Stripe.
--
-- Returns zero rows (not an exception) when the claim is refused — the
-- caller does a separate, read-only lookup purely to produce an accurate
-- user-facing reason, without that lookup ever being what gated the real
-- state change.
-- ============================================================================

create or replace function public.claim_agreed_quote_invitation_checkout(
  p_invitation_id uuid,
  p_customer_id uuid,
  p_now timestamptz
)
returns public.agreed_quote_invitations
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
  'Atomic claim for createAgreedQuoteBookingCheckout: validates ownership (customer_id), status, and — ONLY when no live payment_attempts row exists for the invitation''s booking order — the offer''s own expires_at, all inside one UPDATE. Resuming a genuinely live Stripe attempt always bypasses the expiry check. Returns zero rows (never raises) when refused, so the caller can do a separate read-only lookup to produce an accurate reason.';

revoke all on function public.claim_agreed_quote_invitation_checkout(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.claim_agreed_quote_invitation_checkout(uuid, uuid, timestamptz)
to service_role;
