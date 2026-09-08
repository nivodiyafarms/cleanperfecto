"use server";

import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import { acceptConsentClickwrap } from "@/lib/consent/accept-consent-clickwrap";
import { captureAuditHeaders } from "@/lib/consent/capture-audit-headers";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { declineConsent } from "@/lib/consent/decline-consent";
import { ConsentVersionChangedError, InvalidConsentStateError } from "@/lib/consent/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

/**
 * Portal fallback acceptance — for the rare case a customer reaches
 * /my/consent without having already accepted inline at booking (e.g. an
 * account created before this flow existed, or the active version changed
 * after their last booking). Clickwrap only, same as the booking flow: no
 * typed name, no signature — see acceptConsentClickwrap.
 */
export async function signConsentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const consentRepo = createSupabaseConsentRepository();
  const schedulingRepo = createSupabaseSchedulingRepository();

  const agreedToTerms = formData.get("agreedToTerms") === "true";
  const presentedConsentVersionId = String(formData.get("consentVersionId") ?? "");

  if (!agreedToTerms || !presentedConsentVersionId) {
    return actionError("Please check the box to accept the agreement.");
  }

  const { ipAddress, userAgent } = await captureAuditHeaders();

  try {
    await acceptConsentClickwrap(consentRepo, schedulingRepo, {
      customerId: session.customerId,
      presentedConsentVersionId,
      ipAddress,
      userAgent,
    });
    revalidatePath("/my/consent");
    revalidatePath("/my/profile");
    return actionOk("Accepted — thank you.");
  } catch (error) {
    if (error instanceof ConsentVersionChangedError) return actionError(error.message);
    if (error instanceof InvalidConsentStateError) return actionError(error.message);
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ActionForm/useActionState requires this exact (prevState, formData) shape even though decline takes no fields.
export async function declineConsentAction(_prevState: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const consentRepo = createSupabaseConsentRepository();

  try {
    await declineConsent(consentRepo, session.customerId);
    revalidatePath("/my/consent");
    revalidatePath("/my/profile");
    return actionOk("Declined. You can return and sign at any time.");
  } catch (error) {
    if (error instanceof InvalidConsentStateError) return actionError(error.message);
    throw error;
  }
}
