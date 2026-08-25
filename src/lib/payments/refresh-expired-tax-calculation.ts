import type { ServiceVisitPaymentRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { resolveTaxLocationAddress } from "./resolve-tax-location";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RefreshResult {
  refreshed: boolean;
  payment: ServiceVisitPaymentRow;
}

/**
 * Pre-freeze-only: if the row's persisted Tax Calculation has expired,
 * silently recreates it from the currently-selected tip (nothing about the
 * tip itself changes) and persists the refreshed tax/total. The caller MUST
 * stop and require the customer to explicitly re-confirm against the new
 * total — never proceed to create a PaymentIntent using the pre-refresh
 * numbers in the same call. Refuses (throws) if the row is already frozen —
 * a post-freeze expired calculation is a completely different, tax-sync-
 * only concern (see retry-external-tax-sync.ts), never a silent refresh of
 * an already-paid amount.
 */
export async function refreshExpiredTaxCalculationIfNeeded(
  repo: SchedulingRepository,
  gateway: VisitPaymentGateway,
  visit: ServiceVisitRow,
  payment: ServiceVisitPaymentRow
): Promise<RefreshResult> {
  if (!payment.stripeTaxCalculationId || !payment.taxCalculationExpiresAt) {
    return { refreshed: false, payment };
  }
  if (payment.taxCalculationExpiresAt.getTime() > Date.now()) {
    return { refreshed: false, payment };
  }
  if (payment.tipConfirmedAt) {
    throw new InvalidVisitStateError(
      `service_visit_payments ${payment.id} is already frozen — an expired Tax Calculation after freezing must go through retryExternalTaxSync, never a silent refresh`
    );
  }
  if (!payment.tipSelectionType || payment.tipAmount === null) {
    throw new InvalidVisitStateError(`service_visit_payments ${payment.id} has no tip selection to refresh a Tax Calculation against`);
  }

  const address = resolveTaxLocationAddress(visit);
  const calculation = await gateway.createTaxCalculation({
    serviceAmountCents: toStripeCents(payment.approvedAmount),
    tipAmountCents: toStripeCents(payment.tipAmount),
    address,
  });

  const updated = await repo.updateServiceVisitPaymentTip(payment.id, {
    tipBasisAmount: payment.tipBasisAmount!,
    tipSelectionType: payment.tipSelectionType,
    tipPercentage: payment.tipPercentage,
    tipAmount: payment.tipAmount,
    taxAmount: calculation.taxAmountExclusiveCents / 100,
    totalAmount: calculation.amountTotalCents / 100,
    stripeTaxCalculationId: calculation.id,
    taxCalculationExpiresAt: calculation.expiresAt,
    taxLocationSnapshot: address as unknown as Record<string, unknown>,
  });

  return { refreshed: true, payment: updated };
}
