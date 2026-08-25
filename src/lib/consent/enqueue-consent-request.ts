import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ConsentRepository } from "./consent-repository";

export interface EnqueueConsentRequestInput {
  customerId: string;
  /** Informational only — the booking/visit that prompted this request, if any (null for a prepaid package before its first visit is scheduled). */
  serviceVisitId: string | null;
}

/**
 * The one place a consent_required request is created — called once at
 * booking success (both normal and prepaid-package paths; see
 * process-stripe-webhook-event.ts) and again by an admin's explicit
 * "Resend" action (resend-consent-request.ts).
 *
 * Idempotent by construction: customer_consents' unique (customer_id,
 * consent_version_id) constraint means a repeated call for the same
 * active version is a safe no-op — the notification is only enqueued when
 * a NEW customer_consents row was actually created, so a Stripe webhook
 * retry (or a customer with both a normal booking and a later package)
 * can never produce two consent requests for the same version.
 *
 * A no-op entirely if no consent_versions row is currently active — a
 * defensive guard, not an expected V1 state (the seed migration always
 * activates CP-CONSENT-2026-01).
 */
export async function enqueueConsentRequest(
  consentRepo: ConsentRepository,
  schedulingRepo: SchedulingRepository,
  input: EnqueueConsentRequestInput
): Promise<{ enqueued: boolean }> {
  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) {
    return { enqueued: false };
  }

  const { inserted } = await consentRepo.insertSentRequest({
    customerId: input.customerId,
    consentVersionId: activeVersion.id,
    serviceVisitId: input.serviceVisitId,
  });
  if (!inserted) {
    return { enqueued: false };
  }

  await enqueueNotification(schedulingRepo, {
    serviceVisitId: input.serviceVisitId,
    customerId: input.customerId,
    notificationType: "consent_required",
    channel: "email",
    scheduledSendAt: new Date(),
    versionKey: activeVersion.id,
  });

  return { enqueued: true };
}
