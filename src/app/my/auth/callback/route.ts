import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/customer-portal/next-path";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Exchanges the Supabase magic-link `code` for a session and hands off to
 * /my/activate, which does the actual customer_accounts linking. Also the
 * landing point for links from notification emails/SMS (see
 * src/lib/notifications/portal-link.ts) — those are plain
 * /my/login?next=<path> links through this exact same flow, not a
 * separately pre-generated magic link.
 *
 * `next` is validated against an allowlist of internal /my/... paths only
 * (see sanitizeNextPath) — never trusted as an open redirect target.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/my/login`);
  }

  const response = NextResponse.redirect(`${origin}/my/activate?next=${encodeURIComponent(next)}`);

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
    return NextResponse.redirect(`${origin}/my/login`);
  }

  return response;
}
