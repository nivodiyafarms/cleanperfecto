"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { declineConsent } from "@/lib/consent/decline-consent";
import { InvalidConsentStateError } from "@/lib/consent/errors";
import { signConsent } from "@/lib/consent/sign-consent";
import { createSupabaseSignedConsentDocumentStore } from "@/lib/consent/pdf/signed-consent-document-store";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

/**
 * IP/user-agent are supplemental audit evidence only (see consent-
 * repository.ts) — best-effort from request headers, never required.
 * x-forwarded-for can carry a comma-separated proxy chain; only the
 * client-facing first entry is kept.
 */
async function captureAuditHeaders(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0]?.trim() || null : null;
  const userAgent = headerList.get("user-agent");
  return { ipAddress, userAgent };
}

export async function signConsentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const consentRepo = createSupabaseConsentRepository();
  const schedulingRepo = createSupabaseSchedulingRepository();
  const documentStore = createSupabaseSignedConsentDocumentStore();

  const signedName = String(formData.get("signedName") ?? "");
  const agreedToTerms = formData.get("agreedToTerms") === "true";

  const { ipAddress, userAgent } = await captureAuditHeaders();

  try {
    await signConsent(
      consentRepo,
      schedulingRepo,
      {
        customerId: session.customerId,
        signedName,
        agreedToTerms,
        ipAddress,
        userAgent,
      },
      documentStore
    );
    revalidatePath("/my/consent");
    revalidatePath("/my/profile");
    return actionOk("Signed — thank you.");
  } catch (error) {
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
