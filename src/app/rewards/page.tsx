import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/footer/SiteFooter";
import SiteNav from "@/components/nav/SiteNav";
import {
  HOMEPAGE_REFERRAL_CTA,
  HOMEPAGE_REFERRAL_HEADLINE,
  NEW_CUSTOMER_REFERRAL_CTA,
  NEW_CUSTOMER_REFERRAL_HREF,
  REFERRAL_CODE_HREF,
  REFERRAL_TERMS_LINK,
  REWARDS_PAGE_BULLETS,
  SEE_FULL_TERMS_LABEL,
} from "@/lib/referrals/copy";

export const metadata: Metadata = {
  title: "Offers & Rewards — CleanPerfecto",
  description: "Give $15, Get $15. Your friend saves $15 on their second cleaning. You save $15 on your next.",
};

export default function RewardsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-3xl flex-1 px-6 pb-16 pt-28 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{HOMEPAGE_REFERRAL_HEADLINE}</h1>
        <ul className="mt-6 list-disc space-y-3 pl-5 text-base leading-relaxed text-foreground">
          {REWARDS_PAGE_BULLETS.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href={NEW_CUSTOMER_REFERRAL_HREF}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
          >
            {NEW_CUSTOMER_REFERRAL_CTA}
          </Link>
          <Link
            href={REFERRAL_CODE_HREF}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary sm:w-auto"
          >
            Already a customer? {HOMEPAGE_REFERRAL_CTA}
          </Link>
          <Link
            href={REFERRAL_TERMS_LINK}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-secondary sm:w-auto"
          >
            {SEE_FULL_TERMS_LABEL}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
