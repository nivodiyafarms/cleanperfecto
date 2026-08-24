import { getSiteUrl } from "@/lib/booking/site-url";
import { sanitizeNextPath } from "@/lib/customer-portal/next-path";

/**
 * Builds a plain, absolute CleanPerfecto portal URL (e.g. ".../my/cleanings")
 * for notification content — never a pre-generated magic link or custom
 * token. The destination is protected by the existing customer portal
 * authorization (requireCustomer(), proxy.ts); an expired/absent session
 * bounces through /my/login?next=<path> and back via the existing
 * passwordless login/callback flow, so no separate link-token system is
 * needed here. `path` is re-validated through the same allowlist the login
 * chain itself uses, so a caller can never accidentally build a link
 * outside /my/*.
 */
export function buildPortalLink(path: string): string {
  return `${getSiteUrl()}${sanitizeNextPath(path)}`;
}
