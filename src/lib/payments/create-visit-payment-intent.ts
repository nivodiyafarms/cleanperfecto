import type { BookingRepository } from "@/lib/booking/repository";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { refreshExpiredTaxCalculationIfNeeded } from "./refresh-expired-tax-calculation";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export type CreateVisitPaymentIntentOutcome =
  | { outcome: "needs_payment_method" }
  | { outcome: "refreshed"; approvedAmount: number; tipAmount: number; taxAmount: number; totalAmount: number }
  | { outcome: "no_payment_due" }
  | { outcome: "ready"; clientSecret: string | null; totalAmount: number };

/**
 * Step 3 — Confirm & Pay (stripe_card rail only). Ownership/session checks
 * are the caller's responsibility (same convention as every other
 * customer-portal action — see assertVisitBelongsToCustomer). Idempotent:
 * a repeated call after a PaymentIntent already exists returns its existing
 * client_secret rather than creating another one (Stripe's own idempotency
 * key is the backstop if this check is ever raced).
 */
export async function createVisitPaymentIntent(
  repo: SchedulingRepository,
  bookingRepo: BookingRepository,
  gateway: VisitPaymentGateway,
  input: { serviceVisitId: string; customerId: string }
): Promise<CreateVisitPaymentIntentOutcome> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "completed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has not completed yet`);
  }

  const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!pricing || pricing.priceStatus !== "confirmed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} pricing is not confirmed`);
  }

  let payment = await repo.findServiceVisitPaymentByVisitId(input.serviceVisitId);
  if (!payment) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no payment review yet`);
  }
  if (!payment.tipSelectionType) {
    throw new InvalidVisitStateError("A tip selection is required before payment.");
  }

  if (payment.tipConfirmedAt) {
    // Already frozen. Idempotent recovery: reuse whatever this row already
    // resolved to rather than ever creating a second PaymentIntent.
    if (payment.status === "no_payment_due") {
      return { outcome: "no_payment_due" };
    }
    if (payment.stripePaymentIntentId) {
      const intent = await gateway.retrievePaymentIntent(payment.stripePaymentIntentId);
      return { outcome: "ready", clientSecret: intent.clientSecret, totalAmount: payment.totalAmount ?? 0 };
    }
    throw new InvalidVisitStateError("This payment has already been settled through another method.");
  }

  const refresh = await refreshExpiredTaxCalculationIfNeeded(repo, gateway, visit, payment);
  if (refresh.refreshed) {
    return {
      outcome: "refreshed",
      approvedAmount: refresh.payment.approvedAmount,
      tipAmount: refresh.payment.tipAmount ?? 0,
      taxAmount: refresh.payment.taxAmount ?? 0,
      totalAmount: refresh.payment.totalAmount ?? 0,
    };
  }
  payment = refresh.payment;

  const totalAmount = payment.totalAmount ?? 0;
  if (totalAmount === 0) {
    await repo.freezeServiceVisitPaymentAsNoPaymentDue(payment.id);
    return { outcome: "no_payment_due" };
  }

  const customer = await bookingRepo.getCustomerForStripe(visit.customerId);
  if (!customer || !customer.stripeCustomerId || !customer.stripeDefaultPaymentMethodId) {
    return { outcome: "needs_payment_method" };
  }

  const frozen = await repo.freezeServiceVisitPaymentForStripeCard(payment.id, {
    stripeCustomerId: customer.stripeCustomerId,
    stripePaymentMethodId: customer.stripeDefaultPaymentMethodId,
    cardBrand: customer.stripePaymentMethodBrand,
    cardLast4: customer.stripePaymentMethodLast4,
  });

  const intent = await gateway.createPaymentIntent({
    stripeCustomerId: customer.stripeCustomerId,
    stripePaymentMethodId: customer.stripeDefaultPaymentMethodId,
    amountCents: toStripeCents(totalAmount),
    stripeTaxCalculationId: frozen.stripeTaxCalculationId!,
    metadata: {
      service_visit_id: visit.id,
      service_visit_payment_id: frozen.id,
      tip_amount: String(frozen.tipAmount ?? 0),
    },
    idempotencyKey: frozen.idempotencyKey,
  });

  await repo.setServiceVisitPaymentIntent(frozen.id, { stripePaymentIntentId: intent.id, status: "processing" });

  return { outcome: "ready", clientSecret: intent.clientSecret, totalAmount };
}
