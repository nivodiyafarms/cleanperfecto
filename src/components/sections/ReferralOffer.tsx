import Link from "next/link";
import {
  HOMEPAGE_REFERRAL_CTA,
  HOMEPAGE_REFERRAL_FINE_PRINT,
  HOMEPAGE_REFERRAL_HEADLINE,
  HOMEPAGE_REFERRAL_SUBTEXT,
  REFERRAL_CODE_HREF,
  REFERRAL_TERMS_LINK,
} from "@/lib/referrals/copy";

export default function ReferralOffer() {
  return (
    <section aria-labelledby="referral-offer-heading" className="bg-primary text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8 sm:py-10 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:px-8 lg:py-12">
        <div className="max-w-3xl">
          <h2 id="referral-offer-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {HOMEPAGE_REFERRAL_HEADLINE}
          </h2>
          <p className="mt-2 text-base leading-relaxed sm:text-lg">{HOMEPAGE_REFERRAL_SUBTEXT}</p>
          <p className="mt-3 text-sm leading-relaxed">
            {HOMEPAGE_REFERRAL_FINE_PRINT}{" "}
            <Link href={REFERRAL_TERMS_LINK} className="font-semibold underline underline-offset-2 hover:underline">
              See terms
            </Link>
          </p>
        </div>
        <Link
          href={REFERRAL_CODE_HREF}
          className="inline-flex min-h-12 w-full shrink-0 items-center justify-center rounded-full bg-foreground px-6 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 lg:w-auto lg:px-8"
        >
          {HOMEPAGE_REFERRAL_CTA}
        </Link>
      </div>
    </section>
  );
}
