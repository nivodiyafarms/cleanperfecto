import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/customer-portal/next-path";
import { resolveCustomerAuthConfirmRedirectPath } from "@/lib/customer-portal/resolve-customer-auth-confirm-redirect";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Verifies a `token_hash` credential (Supabase's documented SSR pattern for
 * a server-readable one-click auth link — see customer-auth-link.ts's own
 * doc comment for why /my/auth/callback's `code`-exchange flow cannot
 * handle this) and hands off to /my/activate, which does the actual
 * customer_accounts linking — exactly the same success handoff
 * /my/auth/callback already uses. `next` is validated against an
 * allowlist of internal /my/... paths only (see sanitizeNextPath) — never
 * trusted as an open redirect target. Only `token_hash`/`type`/`next` are
 * ever read from the URL — never a customer id or email, which stay
 * server-side (resolved from the verified Supabase user only, inside
 * /my/activate).
 *
 * type is restricted to the two values CleanPerfecto's own link generator
 * (customer-auth-link.ts) ever requests — never passed through unchecked to
 * verifyOtp, even though a malformed/forged `type` would otherwise just
 * fail verification harmlessly.
 */
const SUPPORTED_VERIFY_TYPES: ReadonlySet<string> = new Set(["magiclink", "email"]);

/**
 * Every response from this route either just established an authenticated
 * session (Set-Cookie) or is a step in doing so — never cacheable by a
 * shared/browser cache, and the incoming URL carries a one-time
 * `token_hash` credential that must never leak onward as a Referer header
 * when the browser follows the redirect. Applied uniformly to every
 * outcome (success AND failure), not just the success path.
 */
function withAuthHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = sanitizeNextPath(searchParams.get("next"));

  if (!tokenHash || !type || !SUPPORTED_VERIFY_TYPES.has(type)) {
    return withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "missing_token" })}`));
  }

  const response = withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "success", next })}`));

  const cookieStore = await cookies();
  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
  if (error) {
    return withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed" })}`));
  }

  return response;
}
