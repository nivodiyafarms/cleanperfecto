import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ConsentRepository } from "./consent-repository";
import { InvalidConsentStateError } from "./errors";

/**
 * Admin's explicit "resend" action — for a customer stuck at sent/viewed/
 * declined with no signature yet. Refuses on an already-signed record
 * (nothing to resend). If no request exists at all yet for the active
 * version, this is equivalent to enqueueConsentRequest with no triggering
 * visit. The idempotency_key uses a fresh timestamp versionKey (not the
 * plain consent_version_id) specifically because this is a DELIBERATE
 * repeat send that must bypass the original request's key.
 */
export async function resendConsentRequest(consentRepo: ConsentRepository, schedulingRepo: SchedulingRepository, customerId: string): Promise<void> {
  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) {
    throw new InvalidConsentStateError("No active consent version is configured.");
  }

  const { record } = await consentRepo.insertSentRequest({ customerId, consentVersionId: activeVersion.id, serviceVisitId: null });
  if (record.state === "signed") {
    throw new InvalidConsentStateError("This customer has already signed the active consent version.");
  }

  await enqueueNotification(schedulingRepo, {
    serviceVisitId: record.serviceVisitId,
    customerId,
    notificationType: "consent_required",
    channel: "email",
    scheduledSendAt: new Date(),
    versionKey: `${activeVersion.id}:resend:${Date.now()}`,
  });
}
