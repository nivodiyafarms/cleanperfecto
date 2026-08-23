import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Exchanges the Supabase magic-link `code` for a session and hands off to
 * /my/activate, which does the actual customer_accounts linking. Also the
 * intended future landing point for secure links from reminder emails/SMS
 * (see the `next` param below) — no redesign needed when that ships, just
 * a different `emailRedirectTo`/link target pointing back here.
 *
 * `next` is validated against an allowlist of internal /my/... paths only
 * — never trusted as an open redirect target.
 */
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/my";
  if (raw !== "/my" && !raw.startsWith("/my/")) return "/my";
  return raw;
}

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
