import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ClaimCustomerLoginLinkRequestResult = { ok: true } | { ok: false; reason: "rate_limited" };

/**
 * Atomic, email-scoped rate limit for /my/login's "email me a sign-in
 * link" request — see claim_customer_login_link_request() in its own
 * migration for the full atomicity rationale. Runs identically regardless
 * of whether `emailNormalized` matches a real customer, so it can never be
 * used to probe account existence.
 */
export async function claimCustomerLoginLinkRequest(
  emailNormalized: string,
  now: Date,
  rateLimitWindowSeconds: number,
  rateLimitMax: number
): Promise<ClaimCustomerLoginLinkRequestResult> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.rpc("claim_customer_login_link_request", {
    p_email_normalized: emailNormalized,
    p_now: now.toISOString(),
    p_rate_limit_window_seconds: rateLimitWindowSeconds,
    p_rate_limit_max: rateLimitMax,
  });

  if (error) {
    if (error.message.includes("rate_limited")) return { ok: false, reason: "rate_limited" };
    throw new Error(`[customer-portal] claim_customer_login_link_request failed: ${error.message}`);
  }
  return { ok: true };
}
