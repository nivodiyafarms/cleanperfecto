import type { BookingRepository } from "@/lib/booking/repository";
import type { AddOnId } from "@/lib/pricing/types";
import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmVisitPricing } from "./confirm-visit-pricing";
import type { ServiceVisitPricingRow, ServiceVisitRow } from "./domain-types";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface FinalizeAndSendInput {
  serviceVisitId: string;
  actor: string;
}

export interface FinalizeAndSendResult {
  /** True when this call found the visit already finalized/sent (status already 'completed') — no pricing/notification/event side effects were repeated. Caller should present current status and offer "Resend link" instead. */
  alreadySent: boolean;
  visit: ServiceVisitRow;
  pricing: ServiceVisitPricingRow | null;
  requiresCustomerApproval: boolean;
}

/**
 * The single admin "Finalize & Send" entry point. Reuses every existing
 * pricing/completion/notification primitive unchanged — this function only
 * sequences them:
 *
 *   1. validate the visit is genuinely work-finished (or already finalized —
 *      see alreadySent below)
 *   2. revalidate final pricing server-side (estimateVisitPricing, using
 *      whatever add-ons are currently on the visit's pricing row — the
 *      admin's own separate "Final Scope" step, updateFinalScopeAction, is
 *      what actually changes them beforehand)
 *   3. freeze pricing (confirmVisitPricing) ONLY if the recomputed total does
 *      NOT require customer approval — confirmVisitPricing itself refuses a
 *      pending-approval amount
 *   4. cross the existing work_finished -> completed boundary via
 *      completeServiceVisit ONLY once pricing is actually frozen (step 3
 *      ran) — "only after final pricing is frozen should the visit cross
 *      the completion/payment boundary." A genuine increase is deliberately
 *      left at price_status='pending_customer_approval' AND
 *      status='work_finished' (NOT completed) — completing it now would
 *      permanently freeze the pending-approval pricing via
 *      protect_service_visit_pricing_after_completion, making it
 *      impossible for the customer to ever approve. It is resolved later,
 *      in one motion, by the customer's own confirmFinalTotalAndPay call,
 *      which itself completes the visit the instant it confirms pricing
 *      (see that file's own doc comment) — so the customer still never sees
 *      a separate "approve" round trip, only a slightly different starting
 *      state.
 *   5+7. log a 'final_total_sent' event and enqueue the 'final_total_ready'
 *      notification with a versionKey of the final total, so a retried
 *      Finalize & Send at the SAME amount is a safe no-op (the notification
 *      idempotency-key UNIQUE constraint — see enqueue-notification.ts) and
 *      a genuinely different amount (a later admin scope edit before this
 *      ran, or an actual retry after a scope change) naturally mints a new
 *      notification rather than being silently swallowed
 *
 * Idempotency: a repeated click after the visit is already 'completed'
 * short-circuits to alreadySent=true before touching estimateVisitPricing
 * (which throws once completed). A repeated click while still
 * 'work_finished' with the SAME pending amount re-logs a 'final_total_sent'
 * event (harmless audit trail of "admin tried again") but never re-sends
 * the notification (idempotency-key collision) and never creates a second
 * pricing snapshot beyond the recompute upsert already inherent to
 * estimateVisitPricing.
 */
export async function finalizeAndSend(
  repo: SchedulingRepository,
  bookingRepo: BookingRepository,
  input: FinalizeAndSendInput
): Promise<FinalizeAndSendResult> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }

  if (visit.status === "completed") {
    const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
    return { alreadySent: true, visit, pricing, requiresCustomerApproval: pricing?.requiresCustomerApproval ?? false };
  }

  if (visit.status !== "work_finished") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} must be marked work-finished before Finalize & Send (current status: ${visit.status})`
    );
  }

  const existingPricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  const addOnIds = (existingPricing?.addOnIds ?? []) as AddOnId[];
  let pricing = await estimateVisitPricing(repo, { serviceVisitId: input.serviceVisitId, addOnIds }, bookingRepo);

  let resultVisit = visit;
  if (!pricing.requiresCustomerApproval) {
    pricing = await confirmVisitPricing(repo, { serviceVisitId: input.serviceVisitId, confirmedBy: input.actor });
    await completeServiceVisit(repo, input.serviceVisitId, input.actor);
    const completedVisit = await repo.findServiceVisitById(input.serviceVisitId);
    if (!completedVisit) {
      throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} disappeared during Finalize & Send`);
    }
    resultVisit = completedVisit;
  }

  await repo.insertServiceVisitEvent({
    serviceVisitId: input.serviceVisitId,
    eventType: "final_total_sent",
    actor: input.actor,
    previousState: null,
    newState: { totalAmount: pricing.totalAmount, requiresCustomerApproval: pricing.requiresCustomerApproval },
    notes: null,
  });

  await enqueueNotification(repo, {
    serviceVisitId: input.serviceVisitId,
    customerId: visit.customerId,
    notificationType: "final_total_ready",
    channel: "email",
    scheduledSendAt: new Date(),
    versionKey: pricing.totalAmount.toFixed(2),
  });

  return { alreadySent: false, visit: resultVisit, pricing, requiresCustomerApproval: pricing.requiresCustomerApproval };
}
