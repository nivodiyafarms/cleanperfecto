import { PRICING_VERSION } from "@/lib/pricing/config";
import { roundToCents } from "@/lib/pricing/money";
import type { AddOnId } from "@/lib/pricing/types";
import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { BookingRepository } from "@/lib/booking/repository";
import type { ServiceVisitPricingRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { classifyAddOns } from "@/lib/pricing/add-ons";

export interface EstimateVisitPricingInput {
  serviceVisitId: string;
  /** Only priced (fixed/starting_at) add-on ids — a caller with manual-quote selections should exclude them here (see request-visit-add-ons.ts, which classifies before calling this). */
  addOnIds: AddOnId[];
}

/**
 * Computes (and persists) the current price estimate for any real
 * service_visit that isn't fully covered by a prepaid package — both the
 * second-and-later visit of a recurring relationship AND the one
 * directly-booked visit of a one-time (non-recurring) booking.
 *
 * base_amount is NOT recomputed here via calculateEstimate() per visit —
 * it is always sourced from an already server-authoritative, previously
 * computed amount, never invented or re-derived by duplicated math:
 *   - Recurring visit (service_visits.recurring_schedule_id is set): the
 *     relationship's active recurring_scope_versions row (see
 *     propose-recurring-scope-change.ts, which IS where calculateEstimate()
 *     runs for that case).
 *   - Directly-booked one-time visit (no recurring_schedule_id, but a
 *     booking_order_id): the booking_orders row's own calculatedTotal,
 *     already produced by calculateEstimate() at booking time (see
 *     create-normal-booking-checkout.ts) and immutable since. Requires a
 *     BookingRepository to resolve.
 * This function only adds each visit's OWN add-on selection on top of that
 * base, via the same add-on catalog (classifyAddOns) every other pricing
 * path uses — never a second, duplicated add-on price list.
 *
 * For a package-linked visit (service_visits.prepaid_package_id is not
 * null), base_amount is 0 (covered by the package) and
 * amount_due_from_customer is add-ons only; otherwise (Pay Per Cleaning,
 * recurring or one-time), amount_due_from_customer is the full total.
 *
 * requires_customer_approval is set only when the newly computed
 * total_amount EXCEEDS the last customer-approved amount for this specific
 * visit — a same-or-lower re-estimate never blocks.
 */
export async function estimateVisitPricing(
  repo: SchedulingRepository,
  input: EstimateVisitPricingInput,
  bookingRepo?: BookingRepository
): Promise<ServiceVisitPricingRow> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }

  const isPackageVisit = visit.prepaidPackageId !== null;

  let baseAmount = 0;
  let baseProvenance: Record<string, unknown> = { baseSource: "package_covered" };
  if (!isPackageVisit) {
    if (visit.recurringScheduleId) {
      const scopeVersion = await repo.findActiveRecurringScopeVersion(visit.recurringScheduleId);
      if (!scopeVersion || scopeVersion.approvedBaseAmount === null) {
        throw new InvalidVisitStateError(
          `recurring_schedule ${visit.recurringScheduleId} has no approved base scope/amount yet — propose and approve one (see propose-recurring-scope-change.ts) before estimating a Pay Per Cleaning visit's price`
        );
      }
      baseAmount = scopeVersion.approvedBaseAmount;
      baseProvenance = { baseSource: "recurring_scope_version", recurringScopeVersionId: scopeVersion.id };
    } else {
      if (!visit.bookingOrderId) {
        throw new InvalidVisitStateError(
          `service_visit ${input.serviceVisitId} has neither a recurring_schedule_id nor a booking_order_id — cannot determine base pricing`
        );
      }
      if (!bookingRepo) {
        throw new InvalidVisitStateError(
          `service_visit ${input.serviceVisitId} is a directly-booked (one-time) visit — estimateVisitPricing requires a BookingRepository to resolve its base price from booking_orders`
        );
      }
      const bookingOrder = await bookingRepo.findBookingOrderById(visit.bookingOrderId);
      if (!bookingOrder) {
        throw new InvalidVisitStateError(`booking_order ${visit.bookingOrderId} referenced by service_visit ${input.serviceVisitId} not found`);
      }
      baseAmount = bookingOrder.calculatedTotal;
      baseProvenance = {
        baseSource: "booking_order",
        bookingOrderId: bookingOrder.id,
        bookingOrderPricingVersion: bookingOrder.pricingVersion,
        bookingOrderPricingSnapshot: bookingOrder.pricingSnapshot,
      };
    }
  }

  const classified = classifyAddOns(input.addOnIds);
  const addOnAmount = roundToCents(classified.pricedTotal);
  const totalAmount = roundToCents(baseAmount + addOnAmount);
  const amountDueFromCustomer = isPackageVisit ? addOnAmount : totalAmount;

  const existing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  const previouslyApprovedAmount = existing?.previouslyApprovedAmount ?? null;
  const requiresCustomerApproval = previouslyApprovedAmount !== null && totalAmount > previouslyApprovedAmount;

  // Only a genuine INCREASE over the last customer-approved amount ever
  // needs a notice — a same-or-lower re-estimate proceeds automatically
  // under the existing business rule and must never notify. versionKey is
  // the new total itself, so re-estimating to the SAME over-threshold
  // amount again (e.g. an idempotent retry) never duplicates the notice,
  // while a DIFFERENT (higher) amount correctly mints a fresh one.
  if (requiresCustomerApproval) {
    await enqueueNotification(repo, {
      serviceVisitId: input.serviceVisitId,
      customerId: visit.customerId,
      notificationType: "pricing_approval_required",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: totalAmount.toFixed(2),
    });
  }

  return repo.upsertServiceVisitPricing({
    serviceVisitId: input.serviceVisitId,
    pricingVersion: PRICING_VERSION,
    pricingSnapshot: { addOnIds: input.addOnIds, priced: classified.priced, baseAmount, ...baseProvenance },
    baseAmount,
    addOnIds: classified.priced.map((p) => p.id),
    addOnAmount,
    totalAmount,
    amountDueFromCustomer,
    priceStatus: requiresCustomerApproval ? "pending_customer_approval" : "estimated",
    requiresCustomerApproval,
    previouslyApprovedAmount,
  });
}
