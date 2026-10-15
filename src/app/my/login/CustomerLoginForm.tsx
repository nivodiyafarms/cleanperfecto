"use client";

import { useState, type FormEvent } from "react";
import { requestCustomerLoginLinkAction } from "@/lib/customer-portal/actions/request-customer-login-link-action";

/**
 * Passwordless customer login — email magic link only, no password field.
 * Submits through requestCustomerLoginLinkAction (a server action), which
 * mints the link via the SAME admin generateLink mechanism every other
 * customer auth link in this app already uses (Finalize & Send, admin/
 * customer resend) and sends it via Resend — replacing the previous
 * client-side supabase.auth.signInWithOtp call.
 *
 * That previous approach depended on Supabase's own Auth "Redirect URLs"
 * allowlist (emailRedirectTo is validated against it before the email is
 * even sent) — confirmed, against a real Preview deployment, to be the
 * actual cause of magic links silently landing on the public homepage
 * instead of the customer portal: an unrecognized emailRedirectTo gets
 * replaced wholesale (origin AND path) with the project's configured Site
 * URL. generateLink() has no such dependency, so this is reliable across
 * every deployment, including ephemeral Preview URLs an allowlist could
 * never practically enumerate.
 *
 * `next` is embedded directly in the generated link's own URL (see
 * createSupabaseCustomerAuthLinkGenerator) — not a cookie or any other
 * client-side state — so the destination survives correctly even when the
 * email is opened in a completely different browser/device than the one
 * that submitted this form.
 *
 * The real authorization boundary is requireCustomer() on the server,
 * re-checked on every subsequent portal page load and every portal server
 * action — this form only ever gets a customer as far as their inbox.
 */
export default function CustomerLoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "rate_limited" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const result = await requestCustomerLoginLinkAction(email, next);

    setStatus(result.ok ? "sent" : result.reason);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <p className="text-sm font-medium text-muted">My CleanPerfecto</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Sign in</h1>

        {status === "sent" ? (
          <p className="mt-6 text-sm text-foreground">
            If an account exists for this email, we&apos;ve sent a secure sign-in link. Check your inbox — you can close this tab.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>

            {status === "rate_limited" && (
              <p role="alert" className="text-sm text-red-600">
                You&apos;ve requested a few sign-in links already — please wait a bit before trying again.
              </p>
            )}

            {status === "error" && (
              <p role="alert" className="text-sm text-red-600">
                Something went wrong sending your link. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {status === "submitting" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs text-muted">Use the email on file with your CleanPerfecto bookings.</p>
      </div>
    </div>
  );
}
