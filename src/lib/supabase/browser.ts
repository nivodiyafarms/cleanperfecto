"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./env";

/**
 * Browser-side Supabase client — publishable key only. Used solely by the
 * admin login form to call `supabase.auth.signInWithPassword(...)`, which
 * is inherently a client-side call against Supabase Auth's own API. Never
 * used to read/write any operational table — those stay server-only.
 */
export function createSupabaseBrowserClient() {
  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
