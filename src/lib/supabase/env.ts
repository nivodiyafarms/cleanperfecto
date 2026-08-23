/**
 * Publishable-key Supabase config, shared by the server and browser auth
 * clients (src/lib/supabase/server.ts, browser.ts). Never the secret key —
 * see src/lib/supabase/admin.ts for that, which stays service-role/
 * server-only and is never used for anything auth-related.
 */
export function getSupabasePublicConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!supabasePublishableKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  return { supabaseUrl, supabasePublishableKey };
}
