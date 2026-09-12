/**
 * Client-side pre-check before ever calling supabase.auth.updateUser() —
 * deliberately stricter than the project's Supabase Auth
 * minimum_password_length (6, see supabase/config.toml) since this account
 * carries owner/operations-level admin capabilities. Supabase's own
 * server-side check remains the actual floor; this only improves UX by
 * catching the common cases (too short, mismatched confirmation) before a
 * network round-trip.
 */
const MIN_PASSWORD_LENGTH = 8;

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
}

export function validateNewAdminPassword(password: string, confirmPassword: string): PasswordValidationResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { valid: false, error: "Passwords do not match." };
  }
  return { valid: true };
}
