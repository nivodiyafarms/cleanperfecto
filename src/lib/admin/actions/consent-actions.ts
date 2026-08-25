"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { InvalidConsentStateError } from "@/lib/consent/errors";
import { resendConsentRequest } from "@/lib/consent/resend-consent-request";
import { retrySignedConsentDocument } from "@/lib/consent/retry-signed-consent-document";
import { createSupabaseSignedConsentDocumentStore } from "@/lib/consent/pdf/signed-consent-document-store";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { actionError, actionOk, type ActionResult } from "./types";

/** Admin's "resend consent request" — for a customer stuck at sent/viewed/declined. Reuses the exact same enqueue path as the original request, through the existing Notifications ledger. */
export async function resendConsentRequestAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const consentRepo = createSupabaseConsentRepository();
  const schedulingRepo = createSupabaseSchedulingRepository();

  const customerId = String(formData.get("customerId") ?? "");
  if (!customerId) return actionError("Missing customer id.");

  try {
    await resendConsentRequest(consentRepo, schedulingRepo, customerId);
  } catch (error) {
    if (error instanceof InvalidConsentStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Consent request resent.");
}

/** Admin-authorized retry when the signed-document PDF failed to generate/store at sign time (see sign-consent.ts). A no-op if a document is already recorded — never regenerates/overwrites an existing one. */
export async function retrySignedConsentDocumentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const consentRepo = createSupabaseConsentRepository();
  const documentStore = createSupabaseSignedConsentDocumentStore();

  const consentId = String(formData.get("consentId") ?? "");
  if (!consentId) return actionError("Missing consent id.");

  try {
    await retrySignedConsentDocument(consentRepo, documentStore, consentId);
  } catch (error) {
    if (error instanceof InvalidConsentStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Signed document generated.");
}

/** Admin toggle for a problem/unhappy visit — never set automatically. */
export async function setReviewRequestSuppressedAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const suppressed = formData.get("suppressed") === "true";
  if (!serviceVisitId) return actionError("Missing visit id.");

  await repo.setReviewRequestSuppressed(serviceVisitId, suppressed);

  revalidatePath("/admin");
  return actionOk(suppressed ? "Review request suppressed for this visit." : "Review request suppression removed.");
}
