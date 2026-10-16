import { redirect } from "next/navigation";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { createSupabaseAgreedQuoteInvitationRepository } from "@/lib/instant-quote/supabase-agreed-quote-invitation-repository";
import AgreedQuoteAcceptanceClient from "@/components/booking/AgreedQuoteAcceptanceClient";
import { SITE_CONTACT } from "@/lib/site-contact";

interface PageProps {
  params: Promise<{ invitationId: string }>;
}

function GenericMessage({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

export default async function AgreedQuoteReviewPage({ params }: PageProps) {
  const { invitationId } = await params;
  const customer = await requireCustomer();
  const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();

  const invitation = await invitationRepo.findAgreedQuoteInvitationSummaryById(invitationId);
  // Generic "not found" regardless of why — never discloses another
  // customer's invitation to an authenticated-but-wrong customer.
  if (!invitation || invitation.customerId !== customer.customerId) {
    return <GenericMessage heading="Offer not found" body={`This offer isn't available. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay} for help.`} />;
  }

  if (invitation.status === "completed") {
    return <GenericMessage heading="You're already enrolled" body="This offer has already been accepted and your enrollment is complete." />;
  }
  if (invitation.status === "cancelled") {
    return <GenericMessage heading="Offer no longer available" body={`This offer is no longer available. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`} />;
  }
  if (invitation.status === "superseded") {
    return <GenericMessage heading="This offer has been updated" body={`A newer version of this offer was sent — please check your email, or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`} />;
  }

  const now = new Date();
  const expired = new Date(invitation.expiresAt).getTime() <= now.getTime();

  if (invitation.status === "checkout_in_progress") {
    const hasLiveAttempt = await invitationRepo.hasLivePaymentAttemptForBookingOrder(invitation.bookingOrderId);
    if (hasLiveAttempt) {
      // §6: never show expired/cancelled here even past expires_at — a
      // live Stripe session can still complete.
      const consentRepo = createSupabaseConsentRepository();
      const activeVersion = await consentRepo.findActiveVersion();
      return (
        <div className="max-w-2xl space-y-4">
          <h1 className="text-xl font-semibold text-foreground">Finishing your enrollment</h1>
          <p className="text-sm text-muted">You started this enrollment already — pick up where you left off.</p>
          <AgreedQuoteAcceptanceClient
            invitationId={invitationId}
            calculationInput={invitation.calculationInput}
            calculationResult={invitation.calculationResult}
            cleaningType={invitation.cleaningType}
            agreedRequestedDate={invitation.agreedRequestedDate}
            agreedRequestedStartTime={invitation.agreedRequestedStartTime}
            activeConsentVersion={activeVersion}
            resuming
          />
        </div>
      );
    }
    // No live attempt — falls back to the normal sent-equivalent logic below.
  }

  if (expired) {
    redirect(`/my/agreed-quote-link-expired?invitation=${encodeURIComponent(invitationId)}`);
  }

  const consentRepo = createSupabaseConsentRepository();
  const activeVersion = await consentRepo.findActiveVersion();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Review your cleaning offer</h1>
      <p className="text-sm text-muted">CleanPerfecto has prepared the following agreed offer for you to review and accept.</p>
      <AgreedQuoteAcceptanceClient
        invitationId={invitationId}
        calculationInput={invitation.calculationInput}
        calculationResult={invitation.calculationResult}
        cleaningType={invitation.cleaningType}
        agreedRequestedDate={invitation.agreedRequestedDate}
        agreedRequestedStartTime={invitation.agreedRequestedStartTime}
        activeConsentVersion={activeVersion}
        resuming={invitation.status === "checkout_in_progress"}
      />
    </div>
  );
}
