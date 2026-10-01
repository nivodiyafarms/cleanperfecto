import type { BookingRepository } from "@/lib/booking/repository";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { assertCanCreateStripeCharge } from "@/lib/config/payment-capabilities";
import { decidePaymentIntentRetry } from "./payment-intent-retry-decision";
import { refreshExpiredTaxCalculationIfNeeded } from "./refresh-expired-tax-calculation";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export type CreateVisitPaymentIntentOutcome =
  | { outcome: "needs_payment_method" }
  | { outcome: "refreshed"; approvedAmount: number; tipAmount: number; taxAmount: number; totalAmount: number }
  | { outcome: "no_payment_due" }
  | { outcome: "ready"; clientSecret: string | null; totalAmount: number };

/**
 * Thrown when the frozen row's existing PaymentIntent is definitively dead
 * (see payment-intent-retry-decision.ts) and no code path currently exists
 * to safely replace it — service_visit_payments.stripe_payment_intent_id is
 * immutable once set (DB trigger, see 20260828100300_create_service_visit_payments.sql).
 * Creating a fresh intent for this row requires a migration relaxing that
 * trigger (authored, not yet applied — see the live-payment hardening
 * blocker register) plus a new repository method to perform the swap.
 * Surfaced as a clear, distinct error rather than silently returning the
 * dead intent's client_secret (which would previously fail confusingly at
 * Stripe.js confirmation time instead of here).
 */
export class DeadPaymentIntentError extends InvalidVisitStateError {
  constructor(serviceVisitId: string, stripePaymentIntentId: string, stripeStatus: string) {
    super(
      `service_visit ${serviceVisitId}'s existing PaymentIntent ${stripePaymentIntentId} is dead (Stripe status: ${stripeStatus}) and cannot be reused. Creating a fresh PaymentIntent for an already-frozen row requires admin/manual intervention pending the retry-lifecycle migration.`
    );
  }
}

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
      if (decidePaymentIntentRetry(intent.status) === "fresh_intent_required") {
        throw new DeadPaymentIntentError(input.serviceVisitId, payment.stripePaymentIntentId, intent.status);
      }
      return { outcome: "ready", clientSecret: intent.clientSecret, totalAmount: payment.totalAmount ?? 0 };
    }

    // Safe-retry: financial facts already froze successfully
    // (freezeServiceVisitPaymentForStripeCard set tip_confirmed_at), but the
    // subsequent gateway.createPaymentIntent call itself failed before an
    // intent id could be persisted (e.g. the frozen payment method was
    // rejected by Stripe as non-card — the real E2E failure this closes).
    // This is NOT an external settlement: record_external_visit_payment_
    // with_audit always sets status='paid' atomically in the same
    // transaction that sets tip_confirmed_at, so status can never
    // legitimately stay 'created' after a real external settlement.
    // Narrowly scoped to exactly this state — never re-freezes, never
    // recomputes any amount, never accepts a different payment method than
    // the one already frozen on the row.
    if (
      payment.status === "created" &&
      payment.paymentMethodType === "stripe_card" &&
      !payment.externalPaymentReference &&
      payment.stripeCustomerId &&
      payment.stripePaymentMethodId &&
      payment.stripeTaxCalculationId
    ) {
      assertCanCreateStripeCharge();
      const retryIntent = await gateway.createPaymentIntent({
        stripeCustomerId: payment.stripeCustomerId,
        stripePaymentMethodId: payment.stripePaymentMethodId,
        amountCents: toStripeCents(payment.totalAmount ?? 0),
        stripeTaxCalculationId: payment.stripeTaxCalculationId,
        metadata: {
          service_visit_id: visit.id,
          service_visit_payment_id: payment.id,
          tip_amount: String(payment.tipAmount ?? 0),
        },
        idempotencyKey: payment.idempotencyKey,
      });
      await repo.setServiceVisitPaymentIntent(payment.id, { stripePaymentIntentId: retryIntent.id, status: "processing" });
      return { outcome: "ready", clientSecret: retryIntent.clientSecret, totalAmount: payment.totalAmount ?? 0 };
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

  // Checked here — after every early-return path that doesn't create a NEW
  // charge (no_payment_due, needs_payment_method, and the idempotent
  // already-frozen reuse above, which only retrieves an existing
  // PaymentIntent) — so a kill-switched PAYMENT_MODE blocks new charges
  // without stranding a payment already legitimately in flight.
  assertCanCreateStripeCharge();

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
