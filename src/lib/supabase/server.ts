import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./env";

/**
 * Per-request, cookie-bound Supabase client for Server Components/Actions —
 * publishable key only, used exclusively to answer "who is logged in"
 * (`supabase.auth.getUser()`), never for reading/writing operational data.
 * Actual admin data access always goes through the existing service-role
 * client (src/lib/supabase/admin.ts). Create a new instance per request —
 * never share one across requests (Supabase's own SSR guidance).
 *
 * `setAll` is wrapped in try/catch: writing cookies from a plain Server
 * Component render is not supported by Next.js and throws — that's fine
 * here, since proxy.ts already refreshes the session cookie on the way in.
 */
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies can't be
          // written — safe to ignore; proxy.ts keeps the session fresh.
        }
      },
    },
  });
}
