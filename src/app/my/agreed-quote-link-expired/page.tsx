import { requestFreshAgreedQuoteLinkFormAction } from "@/lib/customer-portal/actions/agreed-quote-actions";
import { createSupabaseAgreedQuoteInvitationRepository } from "@/lib/instant-quote/supabase-agreed-quote-invitation-repository";
import { SITE_CONTACT } from "@/lib/site-contact";

interface PageProps {
  searchParams: Promise<{ invitation?: string; sent?: string; error?: string }>;
}

const INVITATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unauthenticated, outside the (protected) group — a customer lands here
 * either because /my/auth/confirm couldn't verify their magic-link token,
 * or because the live /my/agreed-quote/[invitationId] page itself detected
 * the offer has expired. Deliberately never calls requireCustomer() and
 * never renders invitation-specific data (scope, price, customer name) —
 * only a generic branded message, same posture as /my/payment-link-expired.
 *
 * §6: self-service "send me a new link" is offered ONLY when a live
 * (non-terminal) Stripe attempt exists for the invitation OR the offer's
 * own business expires_at hasn't passed yet — a live session can still
 * complete regardless of our own clock, so it's never treated as
 * "requires staff Renew" just because expires_at happened to lapse while
 * it was open. Once truly lapsed (or cancelled/superseded), no
 * self-service form is shown at all — only staff renewAgreedQuoteInvitation
 * can reactivate it.
 */
export default async function AgreedQuoteLinkExpiredPage({ searchParams }: PageProps) {
  const { invitation, sent, error } = await searchParams;
  const invitationId = invitation && INVITATION_ID_PATTERN.test(invitation) ? invitation : null;

  let canSelfServe = false;
  if (invitationId) {
    const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();
    const row = await invitationRepo.findAgreedQuoteInvitationById(invitationId);
    if (row && row.status !== "cancelled" && row.status !== "superseded" && row.status !== "completed") {
      const hasLiveAttempt = await invitationRepo.hasLivePaymentAttemptForBookingOrder(row.bookingOrderId);
      const stillValid = new Date(row.expiresAt).getTime() > new Date().getTime();
      canSelfServe = hasLiveAttempt || stillValid;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-muted">My CleanPerfecto</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">This offer link has expired</h1>

        {sent === "1" ? (
          <p className="mt-6 text-sm text-foreground">Check your email for a new secure link. You can close this tab.</p>
        ) : canSelfServe ? (
          <>
            <p className="mt-2 text-sm text-muted">
              For your security, one-click links only work once and expire after a while. Request a new one below and we&apos;ll email it to you right away.
            </p>
            {error === "1" && (
              <p className="mt-4 text-sm text-red-600">
                We couldn&apos;t send a new link just now. Please try again, or contact us at {SITE_CONTACT.phoneDisplay}.
              </p>
            )}
            <form action={requestFreshAgreedQuoteLinkFormAction} className="mt-6">
              <input type="hidden" name="invitationId" value={invitationId ?? ""} />
              <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                Request a new link
              </button>
            </form>
          </>
        ) : (
          <p className="mt-6 text-sm text-muted">
            This offer has expired. Please contact CleanPerfecto at {SITE_CONTACT.phoneDisplay} and we&apos;ll be happy to help.
          </p>
        )}
      </div>
    </div>
  );
}
