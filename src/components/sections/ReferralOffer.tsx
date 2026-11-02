import Link from "next/link";
import { HOMEPAGE_REFERRAL_HEADLINE, REFERRAL_TERMS_LINK } from "@/lib/referrals/copy";

export default function ReferralOffer() {
  return (
    <section className="bg-background-alt px-6 py-8 sm:py-10 lg:px-8 lg:py-12">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 rounded-3xl border border-border bg-surface px-5 py-6 sm:px-8">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{HOMEPAGE_REFERRAL_HEADLINE}</h2>
        <p className="text-sm text-muted sm:text-base">Share your code after you book. Your friend gets $15 off a later cleaning, and so do you.</p>
        <Link href={REFERRAL_TERMS_LINK} className="text-sm font-medium text-secondary underline-offset-2 hover:underline">
          See terms
        </Link>
      </div>
    </section>
  );
}
