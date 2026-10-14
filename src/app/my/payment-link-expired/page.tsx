import { requestFreshPaymentLinkFormAction } from "@/lib/customer-portal/actions/request-fresh-payment-link-action";
import { SITE_CONTACT } from "@/lib/site-contact";

interface PaymentLinkExpiredPageProps {
  searchParams: Promise<{ visit?: string; sent?: string; error?: string }>;
}

const VISIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unauthenticated, outside the (protected) group — a customer lands here
 * precisely BECAUSE their one-click link didn't establish a session (see
 * resolveCustomerAuthConfirmRedirectPath's own doc comment). Deliberately
 * never calls requireCustomer(). Shows no visit-specific data at all (no
 * amount, no address, no status) — only generic branded copy plus a form
 * that re-sends a fresh link, so there is nothing here for an unauthenticated
 * visitor to learn about any particular visit by probing `visit` ids.
 */
export default async function PaymentLinkExpiredPage({ searchParams }: PaymentLinkExpiredPageProps) {
  const { visit, sent, error } = await searchParams;
  const visitId = visit && VISIT_ID_PATTERN.test(visit) ? visit : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-muted">My CleanPerfecto</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">This payment link has expired</h1>

        {sent === "1" ? (
          <p className="mt-6 text-sm text-foreground">
            Check your email for a new secure payment link. You can close this tab.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              For your security, one-click payment links only work once and expire after a while. Request a new one
              below and we&apos;ll email it to you right away.
            </p>

            {error === "1" && (
              <p className="mt-4 text-sm text-red-600">
                We couldn&apos;t send a new link just now. Please try again, or contact us at {SITE_CONTACT.phoneDisplay}.
              </p>
            )}

            {visitId ? (
              <form action={requestFreshPaymentLinkFormAction} className="mt-6">
                <input type="hidden" name="visit" value={visitId} />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Request a new payment link
                </button>
              </form>
            ) : (
              <p className="mt-6 text-sm text-muted">
                Please contact CleanPerfecto at {SITE_CONTACT.phoneDisplay} for help completing your payment.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
