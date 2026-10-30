import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal/LegalDocument";
import {
  CANCELLATION_POLICY_TIERS,
  COMBINED_CONSENT_CHECKBOX_COPY,
  NO_ACCESS_FEE_REPLACEMENT_NOTE,
  PREPAID_PACKAGE_CANCELLATION_NOTE,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
} from "@/lib/booking/cancellation-policy";
import { SERVICE_CONSENT_TEMPLATE } from "@/lib/legal/service-consent-template";
import { MINIMUM_SERVICE_TOTAL } from "@/lib/pricing/config";
import { SITE_CONTACT } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "Terms of Service — CleanPerfecto",
  description: "CleanPerfecto service agreement, cancellation and rescheduling fees, and how your confirmed quote sets the price.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      description="These are the service terms for a CleanPerfecto cleaning. You accept them when you book, or in your account. Last updated October 30, 2026."
    >
      <LegalSection id="agreement" title={SERVICE_CONSENT_TEMPLATE.title}>
        <p>The agreement you accept is kept with your booking.</p>
        <div className="whitespace-pre-wrap rounded-2xl bg-background-alt p-4 text-sm leading-relaxed text-foreground sm:p-5 sm:text-base">
          {SERVICE_CONSENT_TEMPLATE.bodyText}
        </div>
      </LegalSection>

      <LegalSection id="acceptance" title="How you accept">
        <p>During booking, one checkbox covers the service agreement, the cancellation and rescheduling policy, and the payment authorization for that booking:</p>
        <p className="rounded-2xl bg-background-alt p-4 text-sm leading-relaxed sm:text-base">{COMBINED_CONSENT_CHECKBOX_COPY}</p>
        <p>You can also accept the service agreement in your account by typing your legal name.</p>
      </LegalSection>

      <LegalSection id="cancellation" title="Cancellation and rescheduling">
        <p>The fee depends on when you cancel or reschedule.</p>
        <dl className="space-y-3">
          {CANCELLATION_POLICY_TIERS.map((tier) => (
            <div key={tier.window} className="rounded-2xl bg-background-alt px-4 py-3">
              <dt className="font-medium text-foreground">{tier.window}</dt>
              <dd className="mt-1 text-muted">{tier.fee}</dd>
            </div>
          ))}
        </dl>
        <p>{NO_ACCESS_FEE_REPLACEMENT_NOTE}</p>
        <p>{PREPAID_PACKAGE_CANCELLATION_NOTE}</p>
      </LegalSection>

      <LegalSection id="payment-authorization" title="Payment authorization">
        <p>Pay per cleaning:</p>
        <p className="whitespace-pre-wrap rounded-2xl bg-background-alt p-4 text-sm leading-relaxed sm:text-base">{SAVED_PAYMENT_AUTHORIZATION_COPY}</p>
        <p>Prepaid package:</p>
        <p className="whitespace-pre-wrap rounded-2xl bg-background-alt p-4 text-sm leading-relaxed sm:text-base">{PREPAID_PAYMENT_AUTHORIZATION_COPY}</p>
      </LegalSection>

      <LegalSection id="pricing" title="Price">
        <p>
          Starting prices are estimates. Final pricing depends on property size, condition, cleaning type, requested scope, add-ons, and service frequency. Your final rate will be
          confirmed before service.
        </p>
        <p>A ${MINIMUM_SERVICE_TOTAL} minimum service total applies. When an offer says “up to,” that minimum can reduce the discount on a smaller job.</p>
        <p>
          Any first-cleaning offer, recurring savings, or prepaid-package savings that apply are the ones shown on your quote when you book. Your confirmed quote is the price for
          that service. An add-on shown as “starting at,” and any price range on a quote, is an estimate until that rate is confirmed. A fixed rate is available after your first
          service. Restaurant and office quotes are confirmed with us before service.
        </p>
      </LegalSection>

      <LegalSection id="make-it-right" title="24-Hour Make-It-Right Promise">
        <p>We return for missed areas included in the agreed scope.</p>
      </LegalSection>

      <LegalSection id="questions" title="Questions">
        <p>
          Questions about a booking can go to{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>{" "}
          or{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.phoneHref}>
            {SITE_CONTACT.phoneDisplay}
          </a>. How we handle personal information is in the{" "}
          <Link href="/privacy" className="font-medium text-secondary underline-offset-2 hover:underline">
            Privacy Policy
          </Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
