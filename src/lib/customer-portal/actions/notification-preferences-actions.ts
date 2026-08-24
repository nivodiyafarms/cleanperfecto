"use server";

import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import { createSupabaseCustomerNotificationPreferencesRepository } from "@/lib/notifications/customer-notification-preferences-repository";
import { setSmsOptIn } from "@/lib/notifications/set-sms-opt-in";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

/**
 * The minimal SMS opt-in/opt-out control exposed in the portal — not the
 * fuller consent workflow (that's Consent + Review Automation). No real SMS
 * is sent regardless of this preference in this milestone (no Twilio
 * integration exists yet), but the preference itself is real and durable so
 * it's ready the moment SMS activates.
 */
export async function setSmsOptInAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseCustomerNotificationPreferencesRepository();

  const optIn = formData.get("optIn") === "true";

  try {
    await setSmsOptIn(repo, session.customerId, optIn, "portal_profile");
    revalidatePath("/my/profile");
    return actionOk(optIn ? "Text message updates turned on." : "Text message updates turned off.");
  } catch (error) {
    if (error instanceof Error) return actionError(error.message);
    throw error;
  }
}
