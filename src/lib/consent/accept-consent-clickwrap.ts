import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ConsentRepository, CustomerConsentRecord } from "./consent-repository";
import { ConsentVersionChangedError, InvalidConsentStateError } from "./errors";

export interface AcceptConsentClickwrapInput {
  customerId: string;
  /**
   * The consent_versions.id the customer actually saw and checked the box
   * against (rendered server-side into the booking page, never invented by
   * the client) — validated against the current active version below
   * before being trusted. See the ConsentVersionChangedError handling.
   */
  presentedConsentVersionId: string;
  /** Supplemental audit evidence only — see consent-repository.ts. Never required. */
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The one place a REQUIRED booking-flow clickwrap acceptance is recorded —
 * called inline from createNormalBookingCheckout/createPrepaidPackageCheckout
 * before a booking order is created, and also from the /my/consent portal
 * fallback page for the rare case a customer reaches it without having
 * already accepted at booking time.
 *
 * Deliberately NOT signConsent(): this is clickwrap/electronic acceptance,
 * not a typed-signature flow — no signedName is collected from the
 * customer. The existing customer_consents.signed_name evidence column
 * (required by the DB once state='signed') is populated from the
 * customer's own name of record (customers.name, resolved server-side),
 * purely to satisfy that pre-existing column — never presented to the
 * customer as "your signature."
 *
 * Reuses the exact same insertSentRequest()/sign() idempotency the typed
 * flow already relies on: a retried booking submission (same
 * clientRequestId) that calls this twice for the same customer+active
 * version finds the row already state='signed' on the second call and
 * returns it unchanged — no new idempotency mechanism, no duplicate
 * consent row, no re-sign.
 *
 * Version-race handling: if the active version changed between when the
 * booking page rendered and when this runs, presentedConsentVersionId no
 * longer matches the current active version. Rather than silently
 * recording acceptance of a version the customer never actually saw, this
 * throws ConsentVersionChangedError so the caller can surface the new
 * version to the customer for review before letting them resubmit — the
 * customer is never signed against text they didn't see.
 */
export async function acceptConsentClickwrap(
  consentRepo: ConsentRepository,
  schedulingRepo: SchedulingRepository,
  input: AcceptConsentClickwrapInput
): Promise<CustomerConsentRecord> {
  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) {
    throw new InvalidConsentStateError("No active consent version is configured.");
  }
  if (activeVersion.id !== input.presentedConsentVersionId) {
    throw new ConsentVersionChangedError(activeVersion.id);
  }

  const { record: existing } = await consentRepo.insertSentRequest({
    customerId: input.customerId,
    consentVersionId: activeVersion.id,
    // No service_visit_id exists yet at booking time — consent is
    // customer-level, never invalidated by which visit prompted it (same
    // rationale already established for enqueueConsentRequest).
    serviceVisitId: null,
  });

  if (existing.state === "signed") {
    return existing;
  }

  const customerName = (await consentRepo.findCustomerNameById(input.customerId)) ?? "CleanPerfecto customer";

  const accepted = await consentRepo.sign(existing.id, {
    signedName: customerName,
    acceptedTextSnapshot: activeVersion.bodyText,
    acceptanceMethod: "clickwrap",
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await schedulingRepo.cancelPendingConsentRemindersForCustomer(input.customerId);

  return accepted;
}
