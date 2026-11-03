import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ReferralCodeLookupOutcome } from "./check-referral-code-status";

/**
 * Service-role existence/active probe. Selects only `active` so type, owner,
 * customer, and recipient-label columns never enter this path.
 */
export async function lookupReferralCodeActive(normalizedCode: string): Promise<ReferralCodeLookupOutcome> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("referral_codes")
      .select("active")
      .eq("code", normalizedCode)
      .maybeSingle();

    if (error) return "error";
    if (!data) return "missing";
    return data.active === true ? "active" : "inactive";
  } catch {
    return "error";
  }
}
