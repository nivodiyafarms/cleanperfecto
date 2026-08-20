/**
 * Canonical site origin (no trailing slash) for building absolute Stripe
 * Checkout success_url/cancel_url. Falls back to localhost for `next dev`
 * so this never throws during local development.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}
