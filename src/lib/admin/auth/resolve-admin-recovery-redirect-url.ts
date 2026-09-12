import { getSiteUrl } from "@/lib/booking/site-url";

/**
 * The exact, non-user-controllable redirectTo passed to
 * supabase.auth.resetPasswordForEmail() — built entirely from
 * NEXT_PUBLIC_SITE_URL via getSiteUrl() (the same canonical-origin
 * convention already used for Stripe Checkout success/cancel URLs), never
 * from request/user input. Resolves to the exact local value today
 * (http://localhost:3000/admin/auth/callback, per .env.local) and to the
 * real HTTPS production site once NEXT_PUBLIC_SITE_URL is set there —
 * no rewrite needed at that point.
 */
export function resolveAdminRecoveryRedirectUrl(): string {
  return `${getSiteUrl()}/admin/auth/callback`;
}
