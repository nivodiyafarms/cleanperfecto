import type { CustomerAccountRecord, CustomerAccountRepository } from "./customer-account-repository";

export type ActivateCustomerAccountResult =
  | { outcome: "linked"; account: CustomerAccountRecord }
  | { outcome: "already_linked"; account: CustomerAccountRecord }
  | { outcome: "no_match" }
  | { outcome: "multiple_matches"; customerIds: string[] }
  | { outcome: "claimed_by_another_account" };

export interface ActivateCustomerAccountInput {
  supabaseUserId: string;
  /** The email Supabase Auth itself verified (magic link / OTP) — never a client-submitted value taken at face value. Already normalized (see normalize-email.ts) by the caller. */
  verifiedEmailNormalized: string;
}

/**
 * Links a verified Supabase Auth identity to an existing `customers` row —
 * the only code path that ever writes customer_accounts. Never trusts a
 * submitted email after this point; once linked, requireCustomer() resolves
 * identity solely from customer_accounts, never by re-matching email.
 *
 * Safety rules (owner-approved, mirrors resolveCustomer's own conflict
 * philosophy in src/lib/instant-quote/resolve-customer.ts):
 *   - already linked (same supabase_user_id already has a row) -> idempotent no-op, return the existing link
 *   - zero customers match this email -> no_match (never silently create a new customers row)
 *   - more than one customer shares this normalized email (customers.email_normalized has no UNIQUE constraint) -> multiple_matches, never guess
 *   - exactly one match, but it's already claimed by a DIFFERENT supabase_user_id -> claimed_by_another_account, never relink
 *   - exactly one match, unclaimed -> linked
 */
export async function activateCustomerAccount(
  repo: CustomerAccountRepository,
  input: ActivateCustomerAccountInput
): Promise<ActivateCustomerAccountResult> {
  const existingForThisLogin = await repo.findAccountBySupabaseUserId(input.supabaseUserId);
  if (existingForThisLogin) {
    return { outcome: "already_linked", account: existingForThisLogin };
  }

  const matches = await repo.findCustomersByEmailNormalized(input.verifiedEmailNormalized);
  if (matches.length === 0) {
    return { outcome: "no_match" };
  }
  if (matches.length > 1) {
    return { outcome: "multiple_matches", customerIds: matches.map((m) => m.id) };
  }

  const matchedCustomerId = matches[0].id;
  const existingClaim = await repo.findAccountByCustomerId(matchedCustomerId);
  if (existingClaim) {
    return { outcome: "claimed_by_another_account" };
  }

  const account = await repo.createAccount({ supabaseUserId: input.supabaseUserId, customerId: matchedCustomerId });
  return { outcome: "linked", account };
}
