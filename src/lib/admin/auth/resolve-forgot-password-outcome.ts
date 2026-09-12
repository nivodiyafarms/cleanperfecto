/**
 * Classifies a resetPasswordForEmail submission attempt into a UI state —
 * deliberately collapsing "email sent" and "no account for that email"
 * into the same outcome, since Supabase's own resetPasswordForEmail never
 * distinguishes the two in its response (by design, to avoid account
 * enumeration) and this app must not either. Only a genuine unexpected
 * failure (the call itself threw — network error, etc.) gets a distinct
 * outcome, and even then the UI never surfaces Supabase's actual error
 * detail (which could itself leak information, e.g. rate-limit wording).
 */
export type ForgotPasswordOutcome = { status: "submitted" } | { status: "unexpected_error" };

export function resolveForgotPasswordOutcome(threw: boolean): ForgotPasswordOutcome {
  return threw ? { status: "unexpected_error" } : { status: "submitted" };
}
