"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { resolveAdminRecoveryRedirectUrl } from "@/lib/admin/auth/resolve-admin-recovery-redirect-url";
import { resolveForgotPasswordOutcome, type ForgotPasswordOutcome } from "@/lib/admin/auth/resolve-forgot-password-outcome";

/**
 * Browser-initiated password-recovery request — must run in the same
 * browser the owner later opens the recovery email in, since the PKCE
 * code verifier Supabase generates for resetPasswordForEmail is stored
 * locally (see resolveAdminRecoveryRedirectUrl's own doc comment on the
 * matching callback route). Uses only the publishable-key browser client,
 * same convention as /admin/login's signInWithPassword — never
 * supabase.auth.admin.* or the service-role client. Never reveals whether
 * the submitted email actually belongs to an admin account: the same
 * generic message is shown whether or not Supabase found a match, and
 * even Supabase's own error detail is never surfaced (see
 * resolveForgotPasswordOutcome). This page never touches admin_users.
 */
export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ForgotPasswordOutcome | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    let threw = false;
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: resolveAdminRecoveryRedirectUrl() });
    } catch {
      threw = true;
    }

    setOutcome(resolveForgotPasswordOutcome(threw));
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <p className="text-sm font-medium text-muted">CleanPerfecto</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Reset admin password</h1>

        {outcome?.status === "submitted" ? (
          <p className="mt-6 text-sm text-foreground">If an account exists for that email, a password reset link has been sent.</p>
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
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
            </div>

            {outcome?.status === "unexpected_error" && (
              <p role="alert" className="text-sm text-red-600">
                Something went wrong. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send password reset email"}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs text-muted">
          <Link href="/admin/login" className="font-medium text-secondary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
