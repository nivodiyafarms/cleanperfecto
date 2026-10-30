import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalNotice, LegalSection } from "@/components/legal/LegalDocument";
import { ACH_SAVINGS_RATE } from "@/lib/booking/ach-incentive";
import {
  CANCELLATION_POLICY_TIERS,
  CANCELLATION_POLICY_VERSION,
  COMBINED_CONSENT_CHECKBOX_COPY,
  NO_ACCESS_FEE_REPLACEMENT_NOTE,
  PREPAID_PACKAGE_CANCELLATION_NOTE,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
} from "@/lib/booking/cancellation-policy";
import { SERVICE_CONSENT_TEMPLATE } from "@/lib/legal/service-consent-template";
import { getActiveFirstCleaningOffer } from "@/lib/offers/first-cleaning-offer";
import { MINIMUM_SERVICE_TOTAL, PACKAGE_DISCOUNT_MULTIPLIER, PACKAGE_MIN_VISITS, RECURRING_MULTIPLIERS } from "@/lib/pricing/config";
import { FREQUENCIES } from "@/lib/quote/frequency";
import { SITE_CONTACT } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "Terms of Service — CleanPerfecto",
  description: "CleanPerfecto service authorization, cancellation and rescheduling fees, and the pricing rules already used for quotes and bookings.",
};

function percentOff(multiplier: number): number {
  return Math.round((1 - multiplier) * 100);
}

export default function TermsPage() {
  const offer = getActiveFirstCleaningOffer(new Date());
  const packageDiscountPercent = percentOff(PACKAGE_DISCOUNT_MULTIPLIER);
  const achSavingsPercent = Math.round(ACH_SAVINGS_RATE * 100);
  const recurringRates = (["weekly", "biweekly", "every_4_weeks"] as const).map((id) => {
    const multiplier = RECURRING_MULTIPLIERS[id];
    const label = FREQUENCIES.find((frequency) => frequency.id === id)?.label ?? id;
    return { id, label, percent: multiplier === undefined ? null : percentOff(multiplier) };
  });

  return (
    <LegalDocument
      title="Terms of Service"
      description="These terms restate the service agreement and the booking policies already used when a cleaning is booked. Reading this page does not itself book a cleaning or replace the acceptance stored with a booking. Last updated October 29, 2026."
    >
      <LegalNotice>
        The service agreement below is business template {SERVICE_CONSENT_TEMPLATE.versionLabel}. It is pending legal review. The same notice is shown wherever a customer accepts
        it. This page does not add fees, refunds, or obligations that are not already in that agreement or in the booking policies next to it.
      </LegalNotice>

      <LegalSection id="agreement" title={SERVICE_CONSENT_TEMPLATE.title}>
        <p>
          Version {SERVICE_CONSENT_TEMPLATE.versionLabel}. This is the only service-agreement text seeded for booking. The copy a customer accepts is stored with that booking. If a
          newer version is published later, this page has to be updated to match it. This page does not read the live agreement from the database.
        </p>
        <div className="whitespace-pre-wrap rounded-2xl bg-background-alt p-4 text-sm leading-relaxed text-foreground sm:p-5 sm:text-base">
          {SERVICE_CONSENT_TEMPLATE.bodyText}
        </div>
      </LegalSection>

      <LegalSection id="acceptance" title="How a booking is accepted">
        <p>The booking screen uses one checkbox for the service agreement, the cancellation and rescheduling policy, and the payment-method authorization that applies to that booking:</p>
        <p className="rounded-2xl bg-background-alt p-4 text-sm leading-relaxed sm:text-base">{COMBINED_CONSENT_CHECKBOX_COPY}</p>
        <p>The customer portal can also record acceptance of the service agreement, including the typed legal name and the time of acceptance.</p>
      </LegalSection>

      <LegalSection id="cancellation" title="Cancellation and rescheduling">
        <p>Policy version {CANCELLATION_POLICY_VERSION}. Every time below maps to one fee.</p>
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

      <LegalSection id="pricing" title="Pricing">
        <p>
          Starting prices are estimates. Final pricing depends on property size, condition, cleaning type, requested scope, add-ons, and service frequency. Your final rate will be
          confirmed before service.
        </p>
        <p>A ${MINIMUM_SERVICE_TOTAL} minimum service total applies. The minimum can reduce the effective first-cleaning discount on a smaller job, which is why that offer says “up to.”</p>
        <p>
          The first-cleaning offer in effect on the date of the quote is up to {offer.percent}% off the first cleaning
          {offer.expiresAt ? `, through the end date already set for that offer` : ", with no scheduled end date in the current offer rules"}. Travel, supplies, and add-ons are not
          discounted by that offer or by a recurring or package discount. On a first visit that is not a prepaid package of {PACKAGE_MIN_VISITS} or more, the first-cleaning offer
          and the recurring-cycle price are not combined. The one that lowers the cleaning price more is the one that applies.
        </p>
        <p>
          Compared with the one-time cleaning price,{" "}
          {recurringRates
            .map((rate, index) => {
              const name = `${rate.label}${rate.id === "every_4_weeks" ? " (every 4 weeks)" : ""}`;
              const clause = `${name} is ${rate.percent}% lower`;
              if (index === 0) return clause;
              if (index === recurringRates.length - 1) return `, and ${clause.charAt(0).toLowerCase()}${clause.slice(1)}`;
              return `, ${clause.charAt(0).toLowerCase()}${clause.slice(1)}`;
            })
            .join("")}
          {". "}
          A prepaid package of {PACKAGE_MIN_VISITS} or more recurring visits takes an additional {packageDiscountPercent}% off after that recurring price. That package discount
          is not combined with the first-cleaning offer. It applies to the qualifying package. It is not a separate {packageDiscountPercent}% off the next single cleaning.
        </p>
        <p>
          Choosing bank-account payment for a prepaid package of {PACKAGE_MIN_VISITS} or more applies an additional {achSavingsPercent}% savings on the already discounted package
          total. That savings is separate from the {packageDiscountPercent}% package discount and is not advertised as one combined percentage.
        </p>
        <p>
          An add-on shown as “starting at” is not a guaranteed final price. A displayed estimate range is an estimate around the calculated total. The rate confirmed before
          service is the rate for that booking. A fixed rate is available after the first service. Restaurant and office requests are confirmed with CleanPerfecto rather than
          priced as an automatic instant total.
        </p>
        <p>If the property or the requested work is materially different from what was described, CleanPerfecto discusses any change in scope, time, or price before doing work beyond the approved scope. That sentence is part of the service agreement above.</p>
      </LegalSection>

      <LegalSection id="make-it-right" title="24-Hour Make-It-Right Promise">
        <p>We return for missed areas included in the agreed scope. This promise is not a broader satisfaction guarantee. Insured, bonded, and background-checked claims are not stated on the website.</p>
      </LegalSection>

      <LegalSection id="refunds" title="Refunds">
        <LegalNotice>
          The service agreement and the cancellation policy do not publish a general refund window or an automatic right to a refund. This page does not add one.
        </LegalNotice>
        <p>
          The fees above are the published cancellation, rescheduling, and no-access charges. When CleanPerfecto refunds a card payment, staff issue that refund for an amount that
          does not exceed what is still refundable, and a reason is recorded. A cash or Zelle payment is not refunded through that card-refund process. Nothing in the current
          booking terms states a customer refund schedule beyond that.
        </p>
      </LegalSection>

      <LegalSection id="not-stated" title="What these terms do not state">
        <p>
          They do not name a governing state law or a court. They do not state a legal business form or a mailing address. They do not state an age limit. Questions about a booking
          can go to{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>{" "}
          or{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.phoneHref}>
            {SITE_CONTACT.phoneDisplay}
          </a>
          . How personal information is handled is in the{" "}
          <Link href="/privacy" className="font-medium text-secondary underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
