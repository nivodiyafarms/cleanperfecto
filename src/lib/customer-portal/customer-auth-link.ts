import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAppEnv, RuntimeConfigurationError } from "@/lib/config/runtime-env";
import { sanitizeNextPath } from "./next-path";

/**
 * Resolves the CleanPerfecto origin a SERVER-SIDE auth link should redirect
 * back to. The browser-side login flow (CustomerLoginForm.tsx) already gets
 * this right for free via `window.location.origin` — whatever host the
 * customer is actually on. A server-side link generator (a cron dispatcher,
 * no browser, no request) has nothing else to go on, so this has to be
 * explicit and environment-aware instead.
 *
 * development/test default to localhost for zero-config local dev, matching
 * getSiteUrl()'s existing convenience default (src/lib/booking/site-url.ts).
 * operational_beta and production REQUIRE NEXT_PUBLIC_SITE_URL to be
 * explicitly set and throw rather than ever silently substituting the wrong
 * origin — an unset/misconfigured site URL in a deployed environment must
 * block link generation, never guess beta or localhost.
 */
export function resolveCustomerAuthOrigin(overrides?: { appEnv?: string; siteUrl?: string }): string {
  const appEnv = resolveAppEnv(overrides?.appEnv);
  const siteUrl = overrides?.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL;

  if (siteUrl) {
    return siteUrl.replace(/\/$/, "");
  }

  if (appEnv === "development" || appEnv === "test") {
    return "http://localhost:3000";
  }

  throw new RuntimeConfigurationError(
    `NEXT_PUBLIC_SITE_URL must be explicitly set when APP_ENV="${appEnv}" — refusing to guess a customer auth redirect origin.`
  );
}

export type CustomerAuthLinkOutcome = { ok: true; actionLink: string } | { ok: false; reason: string };

export interface CustomerAuthLinkGenerator {
  /**
   * A one-click authenticated link for `email`, landing on `path` (a
   * /my/... path — sanitized the same way every other portal deep link is,
   * see sanitizeNextPath) once /my/auth/confirm verifies it server-side and
   * establishes the session. Handles first-time (no Supabase user yet) and
   * returning customers identically — Supabase's own `magiclink` type
   * creates the user when needed, with no separate signup/confirmation
   * step. Never throws: a failure is returned so callers can always
   * gracefully fall back to a plain (login-required) portal link rather
   * than losing the notification entirely.
   */
  generate(email: string, path: string): Promise<CustomerAuthLinkOutcome>;
}

/**
 * The real implementation — server-only (uses the service-role admin
 * client). Deliberately bypasses Supabase's own outbound email/template
 * system entirely: `generateLink` only ever returns the verification URL
 * data, it never sends anything itself.
 *
 * Returns a CleanPerfecto-hosted /my/auth/confirm URL built from
 * `hashed_token`/`verification_type` (data.properties) — NOT Supabase's own
 * `action_link`/`redirect_to`. Root cause of the 2026-09-27 E2E bug:
 * `action_link` follows Supabase's IMPLICIT verification flow (GET
 * .../auth/v1/verify?token=...&redirect_to=...), which redirects back to
 * CleanPerfecto with the session in the URL FRAGMENT
 * (#access_token=...&refresh_token=...) — a server-side route (like
 * /my/auth/callback) can never read a fragment, since fragments never reach
 * the server in an HTTP request. That callback route expects a `code`
 * query param (the PKCE flow used by the browser-side "Email me a sign-in
 * link" form, CustomerLoginForm.tsx's signInWithOtp) — a `code` that this
 * admin-generated implicit link never produces, so the customer always
 * fell through to /my/login. The token_hash + /my/auth/confirm +
 * verifyOtp({token_hash, type}) pattern below is Supabase's documented SSR
 * alternative — it never touches Supabase's own /verify endpoint or its
 * fragment-based redirect at all, so the CleanPerfecto server can read and
 * verify the credential itself. No `redirectTo` is passed to generateLink()
 * — only hashed_token/verification_type are used, so this has no
 * dependency on Supabase's Auth "Redirect URLs" allowlist at all (unlike
 * the old action_link approach).
 */
export function createSupabaseCustomerAuthLinkGenerator(): CustomerAuthLinkGenerator {
  return {
    async generate(email, path) {
      let origin: string;
      try {
        origin = resolveCustomerAuthOrigin();
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "could not resolve auth redirect origin" };
      }

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email });

      if (error || !data?.properties?.hashed_token || !data?.properties?.verification_type) {
        return { ok: false, reason: error?.message ?? "generateLink returned no hashed_token" };
      }

      const confirmUrl = new URL(`${origin}/my/auth/confirm`);
      confirmUrl.searchParams.set("token_hash", data.properties.hashed_token);
      confirmUrl.searchParams.set("type", data.properties.verification_type);
      confirmUrl.searchParams.set("next", sanitizeNextPath(path));

      return { ok: true, actionLink: confirmUrl.toString() };
    },
  };
}
