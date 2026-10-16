-- ============================================================================
-- Migration: claim_agreed_quote_invitation_cancellation — atomic admin
-- cancellation of an agreed-quote invitation.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Added beyond the original plan's four-migration file list: review found
-- that "read payment_attempts as terminal, then cancel" as two separate
-- steps is vulnerable to a concurrent customer retry creating a fresh live
-- Stripe session in the gap between the read and the write. Folding the
-- "no live attempt" condition into the SAME atomic UPDATE (via NOT EXISTS)
-- closes that race: there is no separate read step for a concurrent retry
-- to slip through. Because this and claim_agreed_quote_invitation_checkout
-- are both single UPDATE ... WHERE statements against the same row,
-- Postgres's normal row-level locking serializes them — whichever commits
-- first is the one the other's WHERE re-evaluates against.
--
-- booking_order_id IS NULL (no Stripe session ever created) makes the NOT
-- EXISTS subquery vacuously true, so cancelling a never-started checkout
-- always succeeds — an interrupted attempt is never permanently blocked
-- from being abandoned by staff.
--
-- Returns zero rows (not an exception) when the cancellation is refused —
-- the caller does a separate, read-only lookup to produce an accurate
-- reason.
-- ============================================================================

create or replace function public.claim_agreed_quote_invitation_cancellation(
  p_invitation_id uuid,
  p_admin_user_id uuid,
  p_now timestamptz
)
returns public.agreed_quote_invitations
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
  'Atomic cancellation claim: refuses while a live (non-terminal) payment_attempts row exists for the invitation''s booking order, folded into the same UPDATE as the status flip so a concurrent customer retry can never create a live session in the gap between checking and cancelling. Vacuously allowed when booking_order_id IS NULL (no session ever created). Returns zero rows (never raises) when refused.';

revoke all on function public.claim_agreed_quote_invitation_cancellation(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.claim_agreed_quote_invitation_cancellation(uuid, uuid, timestamptz)
to service_role;
