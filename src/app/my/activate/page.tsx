import { redirect } from "next/navigation";
import { signOutAction } from "@/lib/customer-portal/actions/auth-actions";
import { activateCustomerAccount } from "@/lib/customer-portal/activate-customer-account";
import { createSupabaseCustomerAccountRepository } from "@/lib/customer-portal/customer-account-repository";
import { normalizeEmail } from "@/lib/instant-quote/normalize-email";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function sanitizeNextPath(raw: string | undefined): string {
  if (!raw) return "/my";
  if (raw !== "/my" && !raw.startsWith("/my/")) return "/my";
  return raw;
}

/**
 * Runs immediately after a successful magic-link/OTP verification, for an
 * authenticated Supabase user with no customer_accounts row yet. Attempts
 * to link them to their existing CleanPerfecto customer record by their
 * VERIFIED email (never a client-submitted one) — see
 * activate-customer-account.ts for the zero/one/many-match safety rules.
 *
 * This route is intentionally OUTSIDE the (protected) group: requireCustomer()
 * itself redirects here on "not linked yet", so this page must never call
 * requireCustomer() (that would loop). It does its own lighter
 * "is there an authenticated user at all" check instead.
 */
export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/my/login");
  }

  const repo = createSupabaseCustomerAccountRepository();
  const result = await activateCustomerAccount(repo, {
    supabaseUserId: user.id,
    verifiedEmailNormalized: normalizeEmail(user.email),
  });

  if (result.outcome === "linked" || result.outcome === "already_linked") {
    redirect(next);
  }

  const message =
    result.outcome === "no_match"
      ? "We couldn't find a CleanPerfecto account for this email. If you've booked with us under a different email or phone number, please contact us."
      : result.outcome === "multiple_matches"
        ? "We found more than one account associated with this email. Please contact us so we can verify your identity."
        : "This account is already linked to a different sign-in. Please contact us for help.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">We couldn&apos;t link your account</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <form action={signOutAction} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
