import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CustomerContactPatch, CustomerRecord, NewCustomerInput } from "./customer-repository";
import type { QuoteRequestRow } from "./build-quote-request-row";
import type { InsertQuoteRequestResult, InstantQuoteRepository } from "./repository";

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
}

function toCustomerRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailNormalized: row.email_normalized,
    phone: row.phone,
    phoneNormalized: row.phone_normalized,
  };
}

/**
 * Production Supabase-backed implementation of InstantQuoteRepository.
 * Deliberately thin — all business logic lives in the pure, independently
 * tested modules (resolve-customer.ts, first-cleaning-eligibility.ts,
 * build-quote-request-row.ts). Never used directly in unit tests for those
 * modules; see submit-instant-quote.test.ts for orchestrator tests against
 * a fake InstantQuoteRepository instead.
 *
 * service_visits has no email/phone columns of its own (see the approved
 * migration) — email/phone eligibility must join through customers first,
 * then check that customer's completed visits. Address eligibility, by
 * contrast, uses service_visits.service_address_identity directly, exactly
 * as approved (no quote_request_id join, no customers join required).
 */
export function createSupabaseInstantQuoteRepository(): InstantQuoteRepository {
  const supabase = createSupabaseAdminClient();

  async function findCustomerIdsBy(column: "email_normalized" | "phone_normalized", value: string): Promise<string[]> {
    const { data, error } = await supabase.from("customers").select("id").eq(column, value);
    if (error) {
      throw new Error(`[instant-quote] customers lookup by ${column} failed: ${error.message}`);
    }
    return (data ?? []).map((row: { id: string }) => row.id);
  }

  async function hasCompletedVisitForCustomerIds(customerIds: string[]): Promise<boolean> {
    if (customerIds.length === 0) {
      return false;
    }
    const { data, error } = await supabase
      .from("service_visits")
      .select("id")
      .eq("status", "completed")
      .in("customer_id", customerIds)
      .limit(1);
    if (error) {
      throw new Error(`[instant-quote] service_visits lookup by customer_id failed: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }

  return {
    async findByEmailNormalized(emailNormalized: string): Promise<CustomerRecord[]> {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,email,email_normalized,phone,phone_normalized")
        .eq("email_normalized", emailNormalized);
      if (error) {
        throw new Error(`[instant-quote] customers lookup by email_normalized failed: ${error.message}`);
      }
      return (data ?? []).map(toCustomerRecord);
    },

    async findByPhoneNormalized(phoneNormalized: string): Promise<CustomerRecord[]> {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,email,email_normalized,phone,phone_normalized")
        .eq("phone_normalized", phoneNormalized);
      if (error) {
        throw new Error(`[instant-quote] customers lookup by phone_normalized failed: ${error.message}`);
      }
      return (data ?? []).map(toCustomerRecord);
    },

    async createCustomer(input: NewCustomerInput): Promise<CustomerRecord> {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          name: input.name,
          email: input.email,
          email_normalized: input.emailNormalized,
          phone: input.phone,
          phone_normalized: input.phoneNormalized,
        })
        .select("id,name,email,email_normalized,phone,phone_normalized")
        .single();
      if (error || !data) {
        throw new Error(`[instant-quote] customer creation failed: ${error?.message ?? "no row returned"}`);
      }
      return toCustomerRecord(data);
    },

    async updateCustomerContact(customerId: string, patch: CustomerContactPatch): Promise<void> {
      if (Object.keys(patch).length === 0) {
        return;
      }
      const dbPatch: Record<string, string> = {};
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.email !== undefined) dbPatch.email = patch.email;
      if (patch.emailNormalized !== undefined) dbPatch.email_normalized = patch.emailNormalized;
      if (patch.phone !== undefined) dbPatch.phone = patch.phone;
      if (patch.phoneNormalized !== undefined) dbPatch.phone_normalized = patch.phoneNormalized;

      const { error } = await supabase.from("customers").update(dbPatch).eq("id", customerId);
      if (error) {
        throw new Error(`[instant-quote] customer contact refresh failed: ${error.message}`);
      }
    },

    async hasCompletedVisitByEmail(emailNormalized: string): Promise<boolean> {
      const customerIds = await findCustomerIdsBy("email_normalized", emailNormalized);
      return hasCompletedVisitForCustomerIds(customerIds);
    },

    async hasCompletedVisitByPhone(phoneNormalized: string): Promise<boolean> {
      const customerIds = await findCustomerIdsBy("phone_normalized", phoneNormalized);
      return hasCompletedVisitForCustomerIds(customerIds);
    },

    async hasCompletedVisitByAddress(serviceAddressIdentity: string): Promise<boolean> {
      const { data, error } = await supabase
        .from("service_visits")
        .select("id")
        .eq("status", "completed")
        .eq("service_address_identity", serviceAddressIdentity)
        .limit(1);
      if (error) {
        throw new Error(`[instant-quote] service_visits lookup by address failed: ${error.message}`);
      }
      return (data ?? []).length > 0;
    },

    async insertQuoteRequest(row: QuoteRequestRow): Promise<InsertQuoteRequestResult> {
      // quote_requests grants service_role INSERT only (no SELECT) — never
      // chain .select() here. `row.id` is already generated server-side by
      // the caller (crypto.randomUUID()), so the caller already knows the
      // inserted id without needing it read back.
      const { error } = await supabase.from("quote_requests").insert(row);
      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    },
  };
}
