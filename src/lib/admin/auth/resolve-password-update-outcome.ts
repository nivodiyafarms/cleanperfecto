/**
 * Classifies the result of supabase.auth.updateUser({ password }) into a UI
 * state, independent of the Supabase client call itself — the extracted
 * decision point ResetPasswordForm renders from, so the outcome logic can
 * be tested without mocking the browser Supabase client.
 */
export type PasswordUpdateOutcome = { status: "success" } | { status: "error"; message: string };

export function resolvePasswordUpdateOutcome(error: { message: string } | null): PasswordUpdateOutcome {
  if (error) {
    return { status: "error", message: error.message };
  }
  return { status: "success" };
}
