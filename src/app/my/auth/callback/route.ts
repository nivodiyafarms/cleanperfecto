import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/customer-portal/next-path";
import { resolveCustomerAuthCallbackRedirectPath } from "@/lib/customer-portal/resolve-customer-auth-callback-redirect";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * The destination cookie CustomerLoginForm sets right before calling
 * signInWithOtp, read back here instead of a `next` query string on
 * `emailRedirectTo`. Supabase Auth's "Redirect URLs" allowlist is matched
 * against the FULL emailRedirectTo Supabase is asked to honor; a dynamic
 * `?next=...` query on it is the single most common reason a magic-link
 * redirect silently falls back to the project's bare Site URL (the public
 * homepage) instead of the requested destination — the exact bug this
 * cookie avoids, by keeping emailRedirectTo a fixed, bare origin+path the
 * allowlist only ever has to match once. One-time use: cleared below on
 * every response path, success or failure, so a stale value can never
 * leak into a later, unrelated login.
 */
const LOGIN_NEXT_COOKIE = "cleanperfecto_login_next";

function clearLoginNextCookie(response: NextResponse): void {
  response.cookies.set(LOGIN_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
}

/**
 * Exchanges the Supabase magic-link `code` for a session and hands off to
 * /my/activate, which does the actual customer_accounts linking. Also the
 * landing point for links from notification emails/SMS (see
 * src/lib/notifications/portal-link.ts) — those are plain
 * /my/login?next=<path> links through this exact same flow, not a
 * separately pre-generated magic link.
 *
 * `next` is read from a `?next=` query param when present (kept for any
 * other caller that still constructs one directly) or else the
 * LOGIN_NEXT_COOKIE above, then validated against an allowlist of internal
 * /my/... paths only (see sanitizeNextPath) — never trusted as an open
 * redirect target either way.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const rawCookieNext = cookieStore.get(LOGIN_NEXT_COOKIE)?.value;
  // CustomerLoginForm writes this cookie via encodeURIComponent (cookie
  // values can't safely carry raw "?"/"="/"&") — decode it back before
  // validating. A malformed/undecodable value is treated as absent rather
  // than thrown, same fail-safe-to-/my behavior as a missing cookie.
  let decodedCookieNext: string | null = null;
  if (rawCookieNext) {
    try {
      decodedCookieNext = decodeURIComponent(rawCookieNext);
    } catch {
      decodedCookieNext = null;
    }
  }
  const next = sanitizeNextPath(searchParams.get("next") ?? decodedCookieNext);

  if (!code) {
    const response = NextResponse.redirect(`${origin}${resolveCustomerAuthCallbackRedirectPath({ status: "missing_code" })}`);
    clearLoginNextCookie(response);
    return response;
  }

  const response = NextResponse.redirect(`${origin}${resolveCustomerAuthCallbackRedirectPath({ status: "success", next })}`);
  clearLoginNextCookie(response);

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const failureResponse = NextResponse.redirect(`${origin}${resolveCustomerAuthCallbackRedirectPath({ status: "exchange_failed" })}`);
    clearLoginNextCookie(failureResponse);
    return failureResponse;
  }

  return response;
}
