import type { CustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import type { BookingRepository } from "@/lib/booking/repository";
import type { AddOnId } from "@/lib/pricing/types";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmVisitPricing } from "./confirm-visit-pricing";
import type { ServiceVisitPricingRow, ServiceVisitRow } from "./domain-types";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { sendFinalTotalReadyImmediately, type SendFinalTotalReadyImmediatelyResult } from "./send-final-total-ready-immediately";

export interface FinalizeAndSendInput {
  serviceVisitId: string;
  actor: string;
}

/** The real notification send-path deps — same shape requestFreshPaymentLink's deps use, injected rather than constructed inside finalizeAndSend so tests can supply fakes. */
export interface FinalizeAndSendNotificationDeps {
  contactLookup: (customerId: string) => Promise<NotificationRecipientContact | null>;
  authLinkGenerator: CustomerAuthLinkGenerator;
  emailSender: NotificationEmailSender;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface FinalizeAndSendResult {
  /** True when this call found the visit already finalized/sent (status already 'completed') — no pricing/notification/event side effects were repeated. Caller should present current status and offer "Resend link" instead. */
  alreadySent: boolean;
  visit: ServiceVisitRow;
  pricing: ServiceVisitPricingRow | null;
  requiresCustomerApproval: boolean;
  /** The actual outcome of the immediate notification send — null only when alreadySent short-circuited before ever attempting one. Pricing/completion above succeed independently of this; the caller must inspect this to show accurate feedback rather than assuming "Sent" whenever the function returns. */
  notification: SendFinalTotalReadyImmediatelyResult | null;
}

/**
 * The single admin "Finalize & Send" entry point. Reuses every existing
 * pricing/completion/notification primitive unchanged — this function only
 * sequences them:
 *
 *   1. validate the visit is genuinely work-finished (or already finalized —
 *      see alreadySent below)
 *   2. revalidate final pricing server-side (estimateVisitPricing, using
 *      whatever add-ons/custom charges/discounts are currently on the
 *      visit's pricing row — the admin's own separate "Final Scope" step,
 *      updateFinalScopeAction, plus the Custom Charge/Discount actions, are
 *      what actually change them beforehand)
 *   3. freeze pricing (confirmVisitPricing) — ALWAYS, regardless of whether
 *      the final total stayed the same, decreased, or increased. Pay Per
 *      Cleaning no longer has a separate customer price-change approval
 *      step (owner-approved product decision, 2026-09-26): the customer's
 *      own explicit Pay action on their Final Total is the sole remaining
 *      authorization point (see confirm-final-total-and-pay.ts), so
 *      Finalize & Send never needs to wait for anything before freezing
 *      pricing and completing the visit here.
 *   4. cross the existing work_finished -> completed boundary via
 *      completeServiceVisit, unconditionally, right after pricing is frozen
 *      in step 3 — every genuine Finalize & Send now completes the visit in
 *      one shot. Its own generic 'completed' customer email is
 *      deliberately SKIPPED here (skipCompletedNotification: true) — the
 *      'final_total_ready' notification below already covers "your
 *      cleaning is complete" AND gives the one-click Final Total link, so
 *      the customer gets exactly one post-cleaning email, not two.
 *   5+7. log a 'final_total_sent' event and send the 'final_total_ready'
 *      notification immediately (sendFinalTotalReadyImmediately), keyed by
 *      the final total amount, so a retried Finalize & Send at the SAME
 *      amount is a safe no-op (the notification idempotency-key UNIQUE
 *      constraint — see insertServiceVisitNotification) and a genuinely
 *      different amount (a later admin scope edit before this ran, or an
 *      actual retry after a scope change) naturally mints a new
 *      notification rather than being silently swallowed. No
 *      'pricing_approval_required' notification and no 'completed'
 *      notification is ever sent for this action — only this one, single
 *      'final_total_ready' notification.
 *
 * Idempotency: a repeated click after the visit is already 'completed'
 * short-circuits to alreadySent=true before touching estimateVisitPricing
 * (which throws once completed).
 */
export async function finalizeAndSend(
  repo: SchedulingRepository,
  bookingRepo: BookingRepository,
  input: FinalizeAndSendInput,
  notificationDeps: FinalizeAndSendNotificationDeps
): Promise<FinalizeAndSendResult> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }

  if (visit.status === "completed") {
    const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
    return { alreadySent: true, visit, pricing, requiresCustomerApproval: pricing?.requiresCustomerApproval ?? false, notification: null };
  }

  if (visit.status !== "work_finished") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} must be marked work-finished before Finalize & Send (current status: ${visit.status})`
    );
  }

  const existingPricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  const addOnIds = (existingPricing?.addOnIds ?? []) as AddOnId[];
  let pricing = await estimateVisitPricing(repo, { serviceVisitId: input.serviceVisitId, addOnIds }, bookingRepo);
  // Captured BEFORE confirmVisitPricing (below) can overwrite it — see that
  // function's own repo method, which always sets
  // previously_approved_amount to the row's OWN total_amount at confirm
  // time. Preserved purely as legacy/historical audit data (never used to
  // gate anything) — without capturing it here first, whatever the row's
  // prior baseline was would never appear in any durable record once
  // confirmed overwrites it.
  const priorApprovedAmount = pricing.previouslyApprovedAmount;

  pricing = await confirmVisitPricing(repo, { serviceVisitId: input.serviceVisitId, confirmedBy: input.actor });
  // Skip the generic 'completed' email here — the 'final_total_ready'
  // notification enqueued below already tells the customer their cleaning
  // is complete AND gives them the one-click Final Total link, so sending
  // both would be two emails for the same event. See
  // CompleteServiceVisitOptions's own doc comment.
  await completeServiceVisit(repo, input.serviceVisitId, input.actor, { skipCompletedNotification: true });
  const completedVisit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!completedVisit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} disappeared during Finalize & Send`);
  }
  const resultVisit = completedVisit;

  await repo.insertServiceVisitEvent({
    serviceVisitId: input.serviceVisitId,
    eventType: "final_total_sent",
    actor: input.actor,
    previousState: priorApprovedAmount !== null ? { previouslyApprovedAmount: priorApprovedAmount } : null,
    newState: { totalAmount: pricing.totalAmount, requiresCustomerApproval: pricing.requiresCustomerApproval },
    notes: null,
  });

  // Sent immediately (not enqueued for the next dispatch-notifications
  // cron sweep) — see send-final-total-ready-immediately.ts's own doc
  // comment for the full atomicity/idempotency rationale and why it's a
  // distinct function from requestFreshPaymentLink rather than a shared
  // call. A send failure here does not undo anything above — pricing is
  // already confirmed and the visit already completed, matching the prior
  // enqueue-based behavior where a later failed cron attempt likewise
  // never rolled those back.
  const notification = await sendFinalTotalReadyImmediately(
    { repo, ...notificationDeps },
    {
      serviceVisitId: input.serviceVisitId,
      customerId: visit.customerId,
      visitStartAtUtc: resultVisit.confirmedStartAt ?? null,
      timezone: resultVisit.timezone,
      totalAmount: pricing.totalAmount,
    }
  );

  return { alreadySent: false, visit: resultVisit, pricing, requiresCustomerApproval: pricing.requiresCustomerApproval, notification };
}
