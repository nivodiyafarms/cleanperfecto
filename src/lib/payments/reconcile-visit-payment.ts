import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ServiceVisitPaymentStatus } from "@/lib/scheduling/types";
import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import { allowedFromStatusesFor } from "./payment-status-transitions";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

const NOTIFICATION_TYPE_BY_STATUS: Partial<Record<ServiceVisitPaymentStatus, "payment_succeeded" | "payment_failed" | "payment_action_required">> = {
  paid: "payment_succeeded",
  payment_failed: "payment_failed",
  requires_action: "payment_action_required",
};

/**
 * Applies a Stripe PaymentIntent webhook event's outcome to the row found
 * by stripe_payment_intent_id — the ONLY place service_visit_payments.status
 * and the service_visit_pricing.payment_status rollup transition for the
 * stripe_card rail. For 'paid', also reconciles the Stripe-automatic Tax
 * Transaction via a read-only tax.associations.find — NEVER calls
 * createFromCalculation for this rail (that's the external-payment-only
 * path, see record-external-payment.ts / retry-external-tax-sync.ts).
 */
export async function reconcileVisitPayment(
  repo: SchedulingRepository,
  gateway: VisitPaymentGateway,
  params: { stripePaymentIntentId: string; status: "processing" | "requires_action" | "payment_failed" | "paid"; failureCode?: string | null; failureMessage?: string | null }
): Promise<void> {
  const payment = await findByPaymentIntentId(repo, params.stripePaymentIntentId);
  if (!payment) return; // Unknown/foreign PaymentIntent — nothing of ours to reconcile.

  // Only stamp paidAt on a genuine first transition into "paid" — a
  // duplicate/redelivered payment_intent.succeeded for an already-paid row
  // (allowed as an idempotent no-op by the transition guard below) must
  // never shift the recorded completion time forward.
  const paidAt = params.status === "paid" && payment.status !== "paid" ? new Date() : undefined;
  const updated = await repo.updateServiceVisitPaymentStatus(
    payment.id,
    { status: params.status, failureCode: params.failureCode ?? null, failureMessage: params.failureMessage ?? null, paidAt },
    allowedFromStatusesFor(params.status)
  );
  if (!updated) {
    // Either nothing matched by id (shouldn't happen, we just looked it up
    // by intent id above) or — the case this guard exists for — the row's
    // CURRENT status isn't a valid source for this transition: a stale or
    // out-of-order Stripe event. Safe no-op, not an error.
    console.warn(
      `[payments] blocked stale/out-of-order transition for service_visit_payments ${payment.id}: current=${payment.status} attempted=${params.status}`
    );
    return;
  }

  await repo.updateServiceVisitPricingPaymentStatus(updated.serviceVisitId, params.status);

  if (params.status === "paid" && updated.stripeTaxCalculationId) {
    await reconcileStripeCardTaxAssociation(repo, gateway, updated.id, params.stripePaymentIntentId);
  }

  const notificationType = NOTIFICATION_TYPE_BY_STATUS[params.status];
  if (notificationType) {
    await enqueueNotification(repo, {
      serviceVisitId: updated.serviceVisitId,
      customerId: (await repo.findServiceVisitById(updated.serviceVisitId))!.customerId,
      notificationType,
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: updated.stripePaymentIntentId ?? updated.id,
    }).catch(() => {});
  }
}

/**
 * Reconciles a charge.refunded event — updates refund fields/status only,
 * never tip/tax/total (frozen). Never manually creates/manipulates a tax
 * reversal — Stripe's linked PaymentIntent Tax integration handles that
 * automatically for the stripe_card rail.
 */
export async function reconcileVisitPaymentRefund(repo: SchedulingRepository, params: { stripePaymentIntentId: string; refundedAmountCents: number; chargeAmountCents: number }): Promise<void> {
  const payment = await findByPaymentIntentId(repo, params.stripePaymentIntentId);
  if (!payment) return;

  const refundedAmount = params.refundedAmountCents / 100;
  const status = params.refundedAmountCents >= params.chargeAmountCents ? "refunded" : "partially_refunded";
  const updated = await repo.updateServiceVisitPaymentRefund(
    payment.id,
    { refundedAmount, refundedAt: new Date(), status },
    allowedFromStatusesFor(status)
  );
  if (updated) {
    await repo.updateServiceVisitPricingPaymentStatus(updated.serviceVisitId, status);
  } else {
    // A refund event whose current status isn't paid/partially_refunded
    // (e.g. arriving before payment_intent.succeeded reconciled, or after
    // the row somehow regressed) is refused rather than silently applied —
    // refunding money against a row that was never marked paid must never
    // happen.
    console.warn(
      `[payments] blocked refund reconciliation for service_visit_payments ${payment.id}: current=${payment.status} attempted=${status}`
    );
  }
}

async function findByPaymentIntentId(repo: SchedulingRepository, stripePaymentIntentId: string) {
  return repo.findServiceVisitPaymentByStripePaymentIntentId(stripePaymentIntentId);
}

/**
 * Read-only reconciliation of Stripe's automatically-committed Tax
 * Transaction for the stripe_card rail — shared by the payment_intent.succeeded
 * webhook handler and the admin "Retry Tax Sync" action for a stripe_card
 * row. NEVER calls createFromCalculation; that call only exists for the
 * external (zelle/cash) rail, which has no linked PaymentIntent for Stripe
 * to auto-commit against.
 */
export async function reconcileStripeCardTaxAssociation(repo: SchedulingRepository, gateway: VisitPaymentGateway, serviceVisitPaymentId: string, stripePaymentIntentId: string): Promise<void> {
  try {
    const association = await gateway.findTaxAssociation(stripePaymentIntentId);
    if (association?.committedTransactionId) {
      await repo.updateServiceVisitPaymentTaxSync(serviceVisitPaymentId, {
        taxTransactionStatus: "committed",
        stripeTaxTransactionId: association.committedTransactionId,
      });
    } else {
      await repo.updateServiceVisitPaymentTaxSync(serviceVisitPaymentId, {
        taxTransactionStatus: "failed",
        taxTransactionFailureMessage: association?.erroredReason ?? "Stripe Tax association not yet committed",
      });
    }
  } catch (error) {
    await repo.updateServiceVisitPaymentTaxSync(serviceVisitPaymentId, {
      taxTransactionStatus: "failed",
      taxTransactionFailureMessage: error instanceof Error ? error.message : "Unknown Stripe Tax reconciliation error",
    });
  }
}
