import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/footer/SiteFooter";
import SiteNav from "@/components/nav/SiteNav";
import { HOMEPAGE_REFERRAL_HEADLINE, REFERRAL_TERMS_LINK, REFERRAL_TERMS_PARAGRAPHS } from "@/lib/referrals/copy";

export const metadata: Metadata = {
  title: "Offers & Rewards — CleanPerfecto",
  description: "Refer a friend and you both get $15 off a later cleaning.",
};

export default function RewardsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-3xl flex-1 px-6 pb-16 pt-28 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{HOMEPAGE_REFERRAL_HEADLINE}</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-foreground sm:text-base">
          {REFERRAL_TERMS_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <p className="mt-6">
          <Link href={REFERRAL_TERMS_LINK} className="text-sm font-medium text-secondary underline-offset-2 hover:underline">
            See terms
          </Link>
        </p>
        <p className="mt-8">
          <Link href="/quote" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-foreground">
            Get My Cleaning Quote
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
