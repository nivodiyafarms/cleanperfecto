import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface NotificationRecipientContact {
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Resolved at DISPATCH time (not enqueue time), deliberately re-fetched
 * fresh from customers on every send attempt — a customer's on-file email/
 * phone (or an opt-out recorded after enqueue) must be honored as of right
 * now, never a stale snapshot taken when the notification was scheduled,
 * possibly hours or days earlier (e.g. a 24h reminder). Self-contained here
 * rather than importing customer-portal's getCustomerProfile, mirroring
 * this schema's convention of each feature module owning its own minimal
 * read of a shared table rather than cross-importing another feature's
 * private query file.
 */
export async function getNotificationRecipientContact(customerId: string): Promise<NotificationRecipientContact | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("customers").select("name, email, phone").eq("id", customerId).maybeSingle();
  if (error) throw new Error(`[notifications] customer contact lookup failed: ${error.message}`);
  return data ? { name: data.name, email: data.email, phone: data.phone } : null;
}
