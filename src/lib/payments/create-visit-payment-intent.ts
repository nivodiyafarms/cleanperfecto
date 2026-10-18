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
  | { outcome: "ready"; clientSecret: string | null; totalAmount: number }
  /**
   * A fresh-attempt claim or a dead-intent-replacement claim found zero
   * eligible rows — already in flight (claimed by a concurrent attempt),
   * already paid, or a "Revise & Resend Final Total" revision is active.
   * Surfaced as a typed, caught outcome rather than ever calling Stripe —
   * the caller should prompt the customer to refresh.
   */
  | { outcome: "not_available_right_now" };

/**
 * Step 3 — Confirm & Pay (stripe_card rail only). Ownership/session checks
 * are the caller's responsibility (same convention as every other
 * customer-portal action — see assertVisitBelongsToCustomer). Idempotent:
 * a repeated call after a PaymentIntent already exists returns its existing
 * client_secret rather than creating another one (Stripe's own idempotency
 * key is the backstop if this check is ever raced).
 *
 * Restructured around three branches (decidePaymentIntentRetry's decision
 * logic is unchanged — only how each branch is PROTECTED changes, closing
 * the "Revise & Resend Final Total" concurrency gap): a fresh attempt and a
 * dead-intent replacement are now each durably claimed (via
 * claimVisitPaymentAttempt / beginVisitPaymentRetry — see
 * src/lib/scheduling/repository.ts) BEFORE Stripe is ever contacted, so a
 * concurrent revision attempt always sees the claim, even before a
 * PaymentIntent exists. A pure resume (the existing intent is still
 * genuinely live) needs no new protection — nothing durable changes.
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
        // Retry branch (b) — the existing intent is definitively dead
        // (canceled). Durably claim the replacement window FIRST (nulling
        // stripe_payment_intent_id under the dedicated
        // app.allow_payment_retry_intent_clear escape), leaving the row at
        // status='processing' with no intent id — structurally identical
        // to the original claim's own pre-intent-id window, so
        // start_visit_pricing_revision's existing rule already covers it.
        assertCanCreateStripeCharge();
        const claim = await repo.beginVisitPaymentRetry({
          serviceVisitId: input.serviceVisitId,
          expectedOldPaymentIntentId: payment.stripePaymentIntentId,
        });
        if (!claim.ok) {
          return { outcome: "not_available_right_now" };
        }
        const replacement = claim.record;
        const replacementIntent = await gateway.createPaymentIntent({
          stripeCustomerId: replacement.stripeCustomerId!,
          stripePaymentMethodId: replacement.stripePaymentMethodId!,
          amountCents: toStripeCents(replacement.totalAmount ?? 0),
          stripeTaxCalculationId: replacement.stripeTaxCalculationId!,
          metadata: {
            service_visit_id: visit.id,
            service_visit_payment_id: replacement.id,
            tip_amount: String(replacement.tipAmount ?? 0),
          },
          idempotencyKey: replacement.idempotencyKey,
        });
        await repo.setServiceVisitPaymentIntent(replacement.id, { stripePaymentIntentId: replacementIntent.id, status: "processing" });
        return { outcome: "ready", clientSecret: replacementIntent.clientSecret, totalAmount: replacement.totalAmount ?? 0 };
      }

      // Resume branch (c) — the existing intent is still genuinely live.
      // No new write, no new RPC call, since nothing durable changes.
      return { outcome: "ready", clientSecret: intent.clientSecret, totalAmount: payment.totalAmount ?? 0 };
    }

    // Safe-retry: financial facts already froze successfully
    // (the row is frozen — tip_confirmed_at is set), but the subsequent
    // gateway.createPaymentIntent call itself failed before an intent id
    // could be persisted (e.g. the frozen payment method was rejected by
    // Stripe as non-card). No live or dead intent exists to resolve here at
    // all, so neither claim RPC applies (begin_visit_payment_retry requires
    // status in ('processing','payment_failed'), which this row — still
    // 'created' — structurally cannot be). This is NOT an external
    // settlement: record_external_visit_payment_with_audit always sets
    // status='paid' atomically in the same transaction that sets
    // tip_confirmed_at, so status can never legitimately stay 'created'
    // after a real external settlement. Narrowly scoped to exactly this
    // state — never re-freezes, never recomputes any amount, never accepts
    // a different payment method than the one already frozen on the row.
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

  // Fresh-attempt branch (a) — durably claim the row (atomically freezing
  // it AND transitioning status 'created' -> 'processing') BEFORE any
  // Stripe API call, so a concurrent revision attempt sees this claim even
  // before a PaymentIntent exists.
  const claim = await repo.claimVisitPaymentAttempt({
    serviceVisitId: input.serviceVisitId,
    stripeCustomerId: customer.stripeCustomerId,
    stripePaymentMethodId: customer.stripeDefaultPaymentMethodId,
    cardBrand: customer.stripePaymentMethodBrand,
    cardLast4: customer.stripePaymentMethodLast4,
  });
  if (!claim.ok) {
    return { outcome: "not_available_right_now" };
  }
  const frozen = claim.record;

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
