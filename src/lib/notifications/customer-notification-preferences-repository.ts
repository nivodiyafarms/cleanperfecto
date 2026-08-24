import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface CustomerNotificationPreferencesRecord {
  customerId: string;
  smsOptIn: boolean;
  smsOptInAt: Date | null;
  smsOptInSource: string | null;
  smsOptOutAt: Date | null;
}

/**
 * Abstraction over customer_notification_preferences access, same intent
 * and shape as CustomerAccountRepository (src/lib/customer-portal/customer-account-repository.ts)
 * — a customer-portal-adjacent settings concern kept in its own small
 * repository rather than folded into SchedulingRepository, which owns
 * service_visit_notifications (the delivery ledger) but has no business
 * owning customer-level preferences.
 *
 * Rows are created lazily: no row for a customer means "never opted in to
 * SMS" (a fully valid default state), same convention as service_visit_pricing.
 */
export interface CustomerNotificationPreferencesRepository {
  findByCustomerId(customerId: string): Promise<CustomerNotificationPreferencesRecord | null>;
  setSmsOptIn(customerId: string, optIn: boolean, source: string): Promise<CustomerNotificationPreferencesRecord>;
}

function toRecord(row: Record<string, unknown>): CustomerNotificationPreferencesRecord {
  return {
    customerId: row.customer_id as string,
    smsOptIn: row.sms_opt_in as boolean,
    smsOptInAt: row.sms_opt_in_at ? new Date(row.sms_opt_in_at as string) : null,
    smsOptInSource: (row.sms_opt_in_source as string | null) ?? null,
    smsOptOutAt: row.sms_opt_out_at ? new Date(row.sms_opt_out_at as string) : null,
  };
}

export function createSupabaseCustomerNotificationPreferencesRepository(): CustomerNotificationPreferencesRepository {
  const supabase = createSupabaseAdminClient();

  return {
    async findByCustomerId(customerId) {
      const { data, error } = await supabase
        .from("customer_notification_preferences")
        .select()
        .eq("customer_id", customerId)
        .maybeSingle();
      if (error) throw new Error(`[notifications] customer_notification_preferences lookup failed: ${error.message}`);
      return data ? toRecord(data) : null;
    },

    async setSmsOptIn(customerId, optIn, source) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("customer_notification_preferences")
        .upsert(
          {
            customer_id: customerId,
            sms_opt_in: optIn,
            sms_opt_in_at: optIn ? now : undefined,
            sms_opt_in_source: optIn ? source : undefined,
            sms_opt_out_at: optIn ? null : now,
          },
          { onConflict: "customer_id" }
        )
        .select()
        .single();
      if (error || !data) throw new Error(`[notifications] customer_notification_preferences upsert failed: ${error?.message ?? "no row returned"}`);
      return toRecord(data);
    },
  };
}
