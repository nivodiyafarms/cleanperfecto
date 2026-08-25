import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { TipSelectionType } from "@/lib/scheduling/types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { resolveTipAmount } from "./tip-rules";
import { resolveTipBasisAmount } from "./resolve-tip-basis";
import { resolveTaxLocationAddress } from "./resolve-tax-location";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface SelectVisitTipInput {
  serviceVisitId: string;
  tipSelectionType: TipSelectionType;
  /** Only used when tipSelectionType is "custom" — never read for a percentage selection, so a client can never forge a percentage's dollar amount. */
  customAmount?: number;
}

export interface SelectVisitTipResult {
  serviceVisitPaymentId: string;
  approvedAmount: number;
  tipAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** True only for a Custom tip crossing the 100%-of-basis or $200 threshold — the caller must obtain an explicit second confirmation before proceeding to Confirm & Pay. */
  requiresConfirmation: boolean;
}

/**
 * Step 2 — Tip. Freely re-callable as the customer changes their selection
 * (refused once the row is frozen — see the DB trigger). Always creates a
 * FRESH final Tax Calculation reflecting the newly selected tip (Tax
 * Calculations are immutable at Stripe; "changing" one means creating a new
 * one and overwriting the stored id — the old one becomes a harmless
 * orphan, never financially consequential since it was never linked to a
 * PaymentIntent).
 */
export async function selectVisitTip(repo: SchedulingRepository, gateway: VisitPaymentGateway, input: SelectVisitTipInput): Promise<SelectVisitTipResult> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }

  const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!pricing || pricing.priceStatus !== "confirmed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} pricing is not confirmed`);
  }

  const payment = await repo.findServiceVisitPaymentByVisitId(input.serviceVisitId);
  if (!payment) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no payment review yet — call prepareVisitPaymentReview first`);
  }
  if (payment.tipConfirmedAt) {
    throw new InvalidVisitStateError("This payment has already been confirmed — the tip can no longer be changed.");
  }

  const tipBasisAmount = await resolveTipBasisAmount(repo, visit, pricing);
  const { tipAmount, tipPercentage, requiresConfirmation } = resolveTipAmount({
    tipSelectionType: input.tipSelectionType,
    tipBasisAmount,
    customAmount: input.customAmount,
  });

  const collectibleTotal = payment.approvedAmount + tipAmount;
  let taxAmount = 0;
  let totalAmount = collectibleTotal;
  let stripeTaxCalculationId: string | null = null;
  let taxCalculationExpiresAt: Date | null = null;

  if (collectibleTotal > 0) {
    const address = resolveTaxLocationAddress(visit);
    const calculation = await gateway.createTaxCalculation({
      serviceAmountCents: toStripeCents(payment.approvedAmount),
      tipAmountCents: toStripeCents(tipAmount),
      address,
    });
    taxAmount = calculation.taxAmountExclusiveCents / 100;
    totalAmount = calculation.amountTotalCents / 100;
    stripeTaxCalculationId = calculation.id;
    taxCalculationExpiresAt = calculation.expiresAt;
  }

  const updated = await repo.updateServiceVisitPaymentTip(payment.id, {
    tipBasisAmount,
    tipSelectionType: input.tipSelectionType,
    tipPercentage,
    tipAmount,
    taxAmount,
    totalAmount,
    stripeTaxCalculationId,
    taxCalculationExpiresAt,
    taxLocationSnapshot: collectibleTotal > 0 ? (resolveTaxLocationAddress(visit) as unknown as Record<string, unknown>) : {},
  });

  return {
    serviceVisitPaymentId: updated.id,
    approvedAmount: updated.approvedAmount,
    tipAmount: updated.tipAmount!,
    taxAmount: updated.taxAmount!,
    totalAmount: updated.totalAmount!,
    requiresConfirmation,
  };
}
