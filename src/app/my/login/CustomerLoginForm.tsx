"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Passwordless customer login — email magic link only, no password field.
 * The one place this app calls Supabase Auth's OTP grant client-side (same
 * pattern as the admin login page's signInWithPassword call). The real
 * authorization boundary is requireCustomer() on the server, re-checked on
 * every subsequent portal page load and every portal server action.
 *
 * `next` (already sanitized by the server page) is forwarded through
 * emailRedirectTo, so /my/auth/callback and /my/activate can land the
 * customer back where they intended — e.g. a plain /my/cleanings
 * notification link that bounced through proxy.ts because the session had
 * expired.
 */
export default function CustomerLoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/my/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });

    setStatus(error ? "error" : "sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <p className="text-sm font-medium text-muted">My CleanPerfecto</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Sign in</h1>

        {status === "sent" ? (
          <p className="mt-6 text-sm text-foreground">
            Check your email for a secure sign-in link. You can close this tab.
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
