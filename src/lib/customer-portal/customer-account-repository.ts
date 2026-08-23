import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface CustomerAccountRecord {
  id: string;
  supabaseUserId: string;
  customerId: string;
  active: boolean;
}

export interface MatchedCustomerRecord {
  id: string;
  emailNormalized: string | null;
}

/**
 * Abstraction over customer_accounts/customers access so
 * activate-customer-account.ts stays testable without a real Supabase
 * connection — same intent as CustomerLookupRepository
 * (src/lib/instant-quote/customer-repository.ts).
 */
export interface CustomerAccountRepository {
  findAccountBySupabaseUserId(supabaseUserId: string): Promise<CustomerAccountRecord | null>;
  findAccountByCustomerId(customerId: string): Promise<CustomerAccountRecord | null>;
  findCustomersByEmailNormalized(emailNormalized: string): Promise<MatchedCustomerRecord[]>;
  createAccount(input: { supabaseUserId: string; customerId: string }): Promise<CustomerAccountRecord>;
}

function toCustomerAccountRecord(row: Record<string, unknown>): CustomerAccountRecord {
  return {
    id: row.id as string,
    supabaseUserId: row.supabase_user_id as string,
    customerId: row.customer_id as string,
    active: row.active as boolean,
  };
}

/**
 * Production Supabase-backed implementation — always via the service-role
 * admin client, since customer_accounts/customers carry the same zero-RLS-
 * policy convention as every other table in this schema.
 */
export function createSupabaseCustomerAccountRepository(): CustomerAccountRepository {
  const supabase = createSupabaseAdminClient();

  return {
    async findAccountBySupabaseUserId(supabaseUserId) {
      const { data, error } = await supabase
        .from("customer_accounts")
        .select("id, supabase_user_id, customer_id, active")
        .eq("supabase_user_id", supabaseUserId)
        .maybeSingle();
      if (error) throw new Error(`[customer-portal] customer_accounts lookup by supabase_user_id failed: ${error.message}`);
      return data ? toCustomerAccountRecord(data) : null;
    },

    async findAccountByCustomerId(customerId) {
      const { data, error } = await supabase
        .from("customer_accounts")
        .select("id, supabase_user_id, customer_id, active")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (error) throw new Error(`[customer-portal] customer_accounts lookup by customer_id failed: ${error.message}`);
      return data ? toCustomerAccountRecord(data) : null;
    },

    async findCustomersByEmailNormalized(emailNormalized) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, email_normalized")
        .eq("email_normalized", emailNormalized);
      if (error) throw new Error(`[customer-portal] customers lookup by email_normalized failed: ${error.message}`);
      return (data ?? []).map((r) => ({ id: r.id as string, emailNormalized: (r.email_normalized as string | null) ?? null }));
    },

    async createAccount(input) {
      const { data, error } = await supabase
        .from("customer_accounts")
        .insert({ supabase_user_id: input.supabaseUserId, customer_id: input.customerId })
        .select("id, supabase_user_id, customer_id, active")
        .single();
      if (error || !data) throw new Error(`[customer-portal] customer_accounts insert failed: ${error?.message ?? "no row returned"}`);
      return toCustomerAccountRecord(data);
    },
  };
}
