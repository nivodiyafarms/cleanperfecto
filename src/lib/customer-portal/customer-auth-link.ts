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
 * explicit and environment-aware instead. This is the ONE shared resolver
 * behind every server-side customer auth link — Finalize & Send
 * (sendFinalTotalReadyImmediately), admin resend, and customer resend
 * (requestFreshPaymentLink) all call createSupabaseCustomerAuthLinkGenerator,
 * which calls this — so a fix here fixes all three, and a bug here breaks
 * all three identically.
 *
 * development/test with NO Vercel runtime (genuine `next dev` on a laptop)
 * default to localhost — zero-config local dev, matching getSiteUrl()'s
 * existing convenience default (src/lib/booking/site-url.ts, a separate,
 * unrelated Stripe-Checkout-URL helper, not touched here).
 *
 * development/test RUNNING ON VERCEL (e.g. a Preview deployment with no
 * NEXT_PUBLIC_SITE_URL/APP_ENV configured for that scope — APP_ENV then
 * defaults to "development") must NOT fall back to localhost: that
 * produces an unreachable `https://<preview-host>:3000/...` link once the
 * host is corrected but the port is still inherited from this origin.
 * Vercel injects VERCEL_URL automatically into every deployment's runtime
 * — the deployment's OWN current hostname, always accurate, never
 * manually configured or able to go stale across ephemeral Preview URLs —
 * so that is preferred over localhost whenever present.
 *
 * operational_beta and production REQUIRE NEXT_PUBLIC_SITE_URL to be
 * explicitly set and throw rather than ever silently substituting VERCEL_URL
 * or localhost — an unset/misconfigured site URL in a real deployed
 * environment must block link generation, never guess beta or production's
 * canonical domain from an internal Vercel alias.
 */
export function resolveCustomerAuthOrigin(overrides?: { appEnv?: string; siteUrl?: string; vercelUrl?: string }): string {
  const appEnv = resolveAppEnv(overrides?.appEnv);
  const siteUrl = overrides?.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL;

  if (siteUrl) {
    return siteUrl.replace(/\/$/, "");
  }

  if (appEnv === "development" || appEnv === "test") {
    const vercelUrl = overrides?.vercelUrl ?? process.env.VERCEL_URL;
    if (vercelUrl) {
      return `https://${vercelUrl}`;
    }
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
   * returning customers with no separate signup/confirmation step on THIS
   * side — Supabase's own `magiclink` request creates the user when needed
   * — but NOT identically end-to-end: GoTrue's response
   * `verification_type` for a first-time email comes back "signup", not
   * "magiclink" (see GenerateLinkType in @supabase/auth-js). This function
   * embeds whatever value Supabase actually returns (never hardcodes
   * "magiclink" below), so /my/auth/confirm's own type allowlist must stay
   * in sync with every value this can legitimately produce — see that
   * route's SUPPORTED_VERIFY_TYPES comment, which drifted out of sync with
   * this until a first-time-customer incident surfaced it. Never throws: a
   * failure is returned so callers can always gracefully fall back to a
   * plain (login-required) portal link rather than losing the notification
   * entirely.
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
