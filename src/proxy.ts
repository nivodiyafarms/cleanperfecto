import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/customer-portal/next-path";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (confirmed against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 * — `middleware.ts` is no longer a recognized file convention). Located at
 * src/proxy.ts per that doc's "same level as app" rule, since this project
 * uses a src/ directory.
 *
 * This is the OPTIMISTIC auth layer only: it refreshes the Supabase session
 * cookie and redirects an unauthenticated visitor away from /admin/*. It
 * deliberately does NOT check admin_users (that's a DB round-trip) — the
 * real, secure check is src/lib/admin/require-admin.ts, called at the top
 * of every admin page/layout and every admin server action. Next's own
 * proxy.ts doc explicitly warns that Server Actions aren't separate routes
 * in Proxy's chain, so relying on this file alone would leave mutations
 * unprotected — see require-admin.ts for the real gate.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /admin/login must never be redirected to itself — an unauthenticated
  // visit there would otherwise loop forever, since the matcher below
  // covers every /admin/* path including this one.
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  // Same reasoning for the customer portal: /my/login must never redirect
  // to itself, and /my/auth/callback is the magic-link exchange route
  // itself (unauthenticated by definition until it runs) — neither can be
  // gated by the same check they're meant to satisfy.
  if (pathname === "/my/login" || pathname.startsWith("/my/login/") || pathname.startsWith("/my/auth/callback")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against Supabase Auth's server — required here to
  // actually refresh/validate the session cookie, not merely decode it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // For the customer portal, carry the originally-requested path through
    // as ?next= so a plain notification link (e.g. /my/cleanings) that hits
    // an expired/absent session still lands the customer back where they
    // intended after signing in — see /my/login and /my/activate, which
    // already read and forward this same param. Admin's bare redirect is
    // unchanged (no admin notification-link use case exists).
    if (pathname.startsWith("/my")) {
      const loginUrl = new URL("/my/login", request.url);
      loginUrl.searchParams.set("next", sanitizeNextPath(pathname));
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/my/:path*"],
};
