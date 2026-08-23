import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CustomerSession {
  customerAccountId: string;
  customerId: string;
  supabaseUserId: string;
}

export type CustomerSessionResult =
  | { status: "unauthenticated" }
  | { status: "not_linked" }
  | { status: "authorized"; session: CustomerSession };

type CustomerAccountLookup = (supabaseUserId: string) => Promise<{ id: string; customerId: string } | null>;

/**
 * Resolves whether an already-authenticated Supabase user id is linked to
 * an active customer_accounts row — the authorization decision itself,
 * independent of how the caller looked it up. Same shape/intent as
 * resolveAdminSession (src/lib/admin/require-admin.ts): the lookup is
 * injected so this stays unit-testable against a fake, never a real
 * Supabase Auth network call.
 */
export function resolveCustomerSession(
  supabaseUserId: string | null,
  lookup: (supabaseUserId: string) => { id: string; customerId: string } | null
): CustomerSessionResult {
  if (!supabaseUserId) {
    return { status: "unauthenticated" };
  }
  const account = lookup(supabaseUserId);
  if (!account) {
    return { status: "not_linked" };
  }
  return { status: "authorized", session: { customerAccountId: account.id, customerId: account.customerId, supabaseUserId } };
}

/**
 * Looks up customer_accounts via the existing service-role admin client —
 * an authenticated-but-unlinked Supabase user has zero grant/RLS access to
 * query this table about themselves, same zero-policy convention as every
 * other table in this schema.
 */
async function findActiveCustomerAccountBySupabaseUserId(supabaseUserId: string): Promise<{ id: string; customerId: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customer_accounts")
    .select("id, customer_id")
    .eq("supabase_user_id", supabaseUserId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    throw new Error(`[customer-portal] customer_accounts lookup failed: ${error.message}`);
  }
  return data ? { id: data.id, customerId: data.customer_id } : null;
}

async function resolveCustomerSessionForCurrentRequest(lookup: CustomerAccountLookup): Promise<CustomerSessionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // never getSession() — see require-admin.ts's own note on why.

  if (!user) {
    return { status: "unauthenticated" };
  }
  const account = await lookup(user.id);
  if (!account) {
    return { status: "not_linked" };
  }
  return { status: "authorized", session: { customerAccountId: account.id, customerId: account.customerId, supabaseUserId: user.id } };
}

/**
 * The real authorization gate — server-only, called at the top of every
 * portal Server Component (page/layout) and every portal server action.
 * Redirects to /my/login if there's no authenticated Supabase user at all.
 * Redirects to /my/activate if authenticated but not yet linked — unlike
 * admin's AdminUnauthorizedError (a hard "you will never be an admin"),
 * "not linked yet" is an EXPECTED first-time state for an existing customer
 * activating portal access, not an error screen.
 */
export async function requireCustomer(): Promise<CustomerSession> {
  const result = await resolveCustomerSessionForCurrentRequest(findActiveCustomerAccountBySupabaseUserId);

  if (result.status === "unauthenticated") {
    redirect("/my/login");
  }
  if (result.status === "not_linked") {
    redirect("/my/activate");
  }
  return result.session;
}
