import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/customer-portal/next-path";
import { resolveCustomerAuthConfirmRedirectPath } from "@/lib/customer-portal/resolve-customer-auth-confirm-redirect";
import { sanitizeAuthConfirmErrorCode, sanitizeAuthConfirmErrorStatus } from "@/lib/customer-portal/sanitize-auth-confirm-error";
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
 * type is restricted to the values CleanPerfecto's own link generator
 * (customer-auth-link.ts) can legitimately produce — never passed through
 * unchecked to verifyOtp, even though a malformed/forged `type` would
 * otherwise just fail verification harmlessly.
 *
 * "signup" is included alongside "magiclink"/"email" because Supabase's
 * admin.generateLink({type:"magiclink"}) does NOT always return
 * verification_type: "magiclink" — per @supabase/auth-js's own
 * GenerateLinkType union, whenever the target email has no existing
 * auth.users row yet, GoTrue creates the user as a side effect and
 * classifies the link as "signup" instead. customer-auth-link.ts's
 * generate() always embeds whatever verification_type Supabase actually
 * returned (see its own code — it never hardcodes "magiclink"), so every
 * FIRST-TIME customer's one-click link legitimately carries type=signup.
 * Omitting it here rejected every first-ever login through this link with
 * "unsupported type" before verifyOtp was ever called — confirmed via a
 * real incident (service_visit 0a4ef785-4704-4eee-9643-c69c0f773c45):
 * auth.users.created_at for that customer exactly matched the
 * generateLink timestamp, and confirmed_at/last_sign_in_at stayed null.
 * "signup" is itself a documented EmailOtpType verifyOtp accepts natively
 * — this was never a token/verification problem, only an incomplete
 * allowlist. "invite"/"recovery"/"email_change_*" remain excluded: our
 * generator's request type is always "magiclink", and Supabase only ever
 * returns "invite" as verification_type for an actual invite-link request,
 * never for ours — those other types belong to different Auth flows this
 * customer-portal-only route has no business accepting.
 */
const SUPPORTED_VERIFY_TYPES: ReadonlySet<string> = new Set(["magiclink", "email", "signup"]);

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

  // Three distinct, separately-logged conditions — deliberately not
  // collapsed into one OR check. "no token at all" and "a token with a
  // type our allowlist doesn't recognize" are different failure classes
  // with different likely causes (a genuinely incomplete link vs. a type
  // this route hasn't been taught to accept yet, see the "signup" case
  // above) — distinguishing them in the log is what made the "signup" gap
  // diagnosable in the first place. next itself is never logged (it's
  // customer-controlled and not reviewed for logging); the query string as
  // a whole is never logged either.
  if (!tokenHash) {
    console.warn("[customer-auth] /my/auth/confirm: missing token_hash");
    return withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "missing_token", next })}`));
  }
  if (!type) {
    console.warn("[customer-auth] /my/auth/confirm: missing type");
    return withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "missing_token", next })}`));
  }
  if (!SUPPORTED_VERIFY_TYPES.has(type)) {
    // Fixed, non-interpolated label — the actual type value is never
    // logged, even sanitized. It arrives as a customer-controlled query
    // param, and a fixed "unsupported" signal is enough to distinguish this
    // branch from the other two without taking on any echo-the-input risk.
    console.warn("[customer-auth] /my/auth/confirm: unsupported type");
    return withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "missing_token", next })}`));
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
    // Sanitized signal only — error.code is Supabase Auth's own closed,
    // documented enum (see sanitize-auth-confirm-error.ts); error.message
    // (free text) and the token_hash/request URL are never logged. This is
    // what lets a FUTURE occurrence actually be diagnosed — whether it's
    // a routine expired/already-used link (otp_expired) or something else
    // (e.g. a clock-skew-driven rejection, still only a hypothesis until a
    // real code/status is captured here) is not asserted by this log line.
    console.warn(
      `[customer-auth] /my/auth/confirm: verifyOtp rejected (code=${sanitizeAuthConfirmErrorCode(error)} status=${sanitizeAuthConfirmErrorStatus(error)})`
    );
    return withAuthHeaders(NextResponse.redirect(`${origin}${resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next })}`));
  }

  return response;
}
