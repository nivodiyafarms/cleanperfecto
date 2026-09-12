"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { signOutAction } from "@/lib/admin/actions/auth-actions";
import { validateNewAdminPassword } from "@/lib/admin/auth/validate-new-admin-password";
import { resolvePasswordUpdateOutcome } from "@/lib/admin/auth/resolve-password-update-outcome";

/**
 * The only place this app calls supabase.auth.updateUser({ password }) —
 * inherently a browser call, same convention as /admin/login's
 * signInWithPassword. The password is never sent to this app's own server;
 * it goes directly from the browser to Supabase Auth. On success, signs
 * out the recovery session (signOutAction, the same action the protected
 * admin layout already uses) and redirects to /admin/login so the owner
 * verifies the newly-set password through the normal login path, rather
 * than staying signed in on a recovery session. This never inserts or
 * updates admin_users — this page has no reference to that table at all.
 */
export default function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const validation = validateNewAdminPassword(password, confirmPassword);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid password.");
      return;
    }

    setSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    const outcome = resolvePasswordUpdateOutcome(updateError ? { message: updateError.message } : null);

    if (outcome.status === "error") {
      setError("We couldn't set your password. Your recovery link may have expired — request a new one and try again.");
      setSubmitting(false);
      return;
    }

    await signOutAction();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-foreground">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
        />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}
