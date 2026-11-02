import Link from "next/link";
import CopyReferralCode from "@/components/referrals/CopyReferralCode";
import { getSiteUrl } from "@/lib/booking/site-url";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { PORTAL_REFERRAL_HEADLINE, REFERRAL_TERMS_LINK } from "@/lib/referrals/copy";
import { createSupabaseReferralRepository } from "@/lib/referrals/supabase-referral-repository";

export default async function CustomerRewardsPage() {
  const session = await requireCustomer();
  let code: string | null = null;
  let credits: { id: string; amount: number; expiresAt: string }[] = [];
  let unavailable = false;

  try {
    const repo = createSupabaseReferralRepository();
    code = await repo.issueCustomerCode(session.customerId);
    const summary = await repo.customerSummary(session.customerId);
    code = summary.code ?? code;
    credits = summary.credits;
  } catch {
    unavailable = true;
  }

  const shareLink = code ? `${getSiteUrl()}/quote?ref=${encodeURIComponent(code)}` : null;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{PORTAL_REFERRAL_HEADLINE}</h1>
        <p className="mt-2 text-sm text-muted">Share your code. Your friend gets $15 off a later cleaning, and so do you.</p>
      </div>

      {unavailable ? (
        <p className="text-sm text-foreground">Rewards are temporarily unavailable.</p>
      ) : (
        <>
          {code ? (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="font-mono text-lg tracking-widest text-foreground">{code}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <CopyReferralCode code={code} />
                {shareLink ? (
                  <a href={shareLink} className="text-sm font-medium text-secondary underline-offset-2 hover:underline">
                    {shareLink}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div>
            <h2 className="text-sm font-semibold text-foreground">Available credits</h2>
            {credits.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No credits available yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {credits.map((credit) => (
                  <li key={credit.id} className="rounded-xl border border-border px-3 py-2 text-sm text-foreground">
                    ${credit.amount.toFixed(2)} · expires {new Date(credit.expiresAt).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Link href={REFERRAL_TERMS_LINK} className="text-sm font-medium text-secondary underline-offset-2 hover:underline">
        See terms
      </Link>
    </section>
  );
}
