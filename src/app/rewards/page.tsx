import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/footer/SiteFooter";
import SiteNav from "@/components/nav/SiteNav";
import {
  HOMEPAGE_REFERRAL_CTA,
  HOMEPAGE_REFERRAL_HEADLINE,
  EXISTING_CUSTOMER_REFERRAL_PROMPT,
  NEW_CUSTOMER_REFERRAL_ACTION,
  NEW_CUSTOMER_REFERRAL_PROMPT,
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
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-stretch">
          <Link
            href={NEW_CUSTOMER_REFERRAL_HREF}
            className="inline-flex min-h-11 w-full flex-col items-center justify-center rounded-full px-4 py-2 text-center text-sm leading-tight sm:min-w-0 sm:flex-1 bg-foreground font-semibold text-white transition-opacity hover:opacity-90"
          >
            <span className="block">{NEW_CUSTOMER_REFERRAL_PROMPT}</span>
            <span className="block">{NEW_CUSTOMER_REFERRAL_ACTION}</span>
          </Link>
          <Link
            href={REFERRAL_CODE_HREF}
            className="inline-flex min-h-11 w-full flex-col items-center justify-center rounded-full px-4 py-2 text-center text-sm leading-tight sm:min-w-0 sm:flex-1 bg-primary font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <span className="block">{EXISTING_CUSTOMER_REFERRAL_PROMPT}</span>
            <span className="block">{HOMEPAGE_REFERRAL_CTA}</span>
          </Link>
          <Link
            href={REFERRAL_TERMS_LINK}
            className="inline-flex min-h-11 w-full flex-col items-center justify-center rounded-full px-4 py-2 text-center text-sm leading-tight sm:min-w-0 sm:flex-1 whitespace-nowrap border border-border font-medium text-foreground transition-colors hover:border-secondary"
          >
            {SEE_FULL_TERMS_LABEL}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
