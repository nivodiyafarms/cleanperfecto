import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { resolveRecoveryCallbackRedirectPath } from "@/lib/admin/auth/resolve-recovery-callback-redirect";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Exchanges the Supabase PKCE `code` for a session — the admin-side
 * equivalent of src/app/my/auth/callback/route.ts, reusing the exact same
 * exchangeCodeForSession architecture (this project's Supabase clients all
 * default to flowType: "pkce" via @supabase/ssr; there is no implicit-flow
 * hash-fragment handling anywhere in this codebase, and this route
 * intentionally doesn't add one).
 *
 * Unlike the customer callback, there is no `next` destination: this route
 * exists solely for the password-recovery flow
 * (supabase.auth.resetPasswordForEmail), so a successful exchange always
 * goes to exactly one place, /admin/reset-password. No redirect target is
 * ever accepted from the request, so there is no open-redirect surface to
 * validate against. Establishing a session here does NOT grant admin
 * access on its own — /admin/reset-password and every other /admin/* page
 * still goes through requireAdmin()'s admin_users lookup.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}${resolveRecoveryCallbackRedirectPath({ status: "missing_code" })}`);
  }

  const response = NextResponse.redirect(`${origin}${resolveRecoveryCallbackRedirectPath({ status: "success" })}`);

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}${resolveRecoveryCallbackRedirectPath({ status: "exchange_failed" })}`);
  }

  return response;
}
