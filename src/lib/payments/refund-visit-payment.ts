import { randomUUID } from "node:crypto";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ServiceVisitPaymentRow } from "@/lib/scheduling/domain-types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RefundVisitPaymentInput {
  serviceVisitId: string;
  /** Dollars, positive. Full or partial — the caller (admin action) computes this; this function only enforces it never exceeds the remaining refundable balance. */
  refundAmount: number;
  reason: string;
  actorAdminUserId: string;
  actorRole: string;
}

/**
 * Owner-controlled refund for the stripe_card rail's Pay-Per-Cleaning
 * charge — RBAC (requireAdmin + assertCapability("issue_refund")) is the
 * CALLER's responsibility (see src/lib/admin/actions/payment-actions.ts),
 * same layering convention as recordExternalPayment (which itself only
 * checks the runtime-mode capability, not the RBAC one).
 *
 * Only the stripe_card rail is handled here — a service_visit_payments row
 * with no stripePaymentIntentId (an external zelle/cash settlement) has no
 * Stripe refund to issue; correcting an external payment is a distinct,
 * not-yet-built manual-correction flow (see AdminCapability's
 * "financial_correction", reserved), not silently attempted here.
 *
 * Order of operations: the Stripe refund call happens FIRST — if it
 * fails, nothing is written locally at all. Only once Stripe has
 * confirmed the refund does refundServiceVisitPaymentWithAudit commit the
 * local financial state AND the required financial_audit_log row
 * atomically (one Postgres transaction, mirroring
 * recordExternalServiceVisitPaymentWithAudit). That RPC is itself the
 * terminal-state/no-over-refund guard (Phase A's rules, enforced at the
 * DB layer under a row lock) — this function's own pre-check is an
 * optimistic fast-fail, not the authoritative one.
 *
 * Phase F — Stripe Tax reversal: best-effort, AFTER the refund has
 * already committed, and never rolls it back on failure (same
 * "settlement is a payment fact; tax bookkeeping stays mutable and
 * best-effort" architecture as record-external-payment.ts's phase 2).
 * Skipped deterministically (not an error) when the original payment has
 * no committed Stripe Tax transaction to reverse — e.g. TAX_MODE was
 * disabled at the time of the original charge.
 */
export async function refundVisitPayment(
  repo: SchedulingRepository,
  gateway: VisitPaymentGateway,
  input: RefundVisitPaymentInput
): Promise<ServiceVisitPaymentRow> {
  if (input.refundAmount <= 0) {
    throw new InvalidVisitStateError("Refund amount must be positive.");
  }

  const payment = await repo.findServiceVisitPaymentByVisitId(input.serviceVisitId);
  if (!payment) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no payment record`);
  }
  if (payment.status !== "paid" && payment.status !== "partially_refunded") {
    throw new InvalidVisitStateError(`service_visit_payments ${payment.id} is not eligible for refund (current status: ${payment.status})`);
  }
  if (!payment.stripePaymentIntentId) {
    throw new InvalidVisitStateError(`service_visit_payments ${payment.id} has no Stripe PaymentIntent — external (zelle/cash) settlements require a separate correction flow, not this refund path.`);
  }

  const remaining = (payment.totalAmount ?? 0) - (payment.refundedAmount ?? 0);
  if (input.refundAmount > remaining) {
    throw new InvalidVisitStateError(
      `Refund amount ${input.refundAmount} exceeds the remaining refundable balance of ${remaining} for service_visit_payments ${payment.id}.`
    );
  }

  const refund = await gateway.createRefund({
    stripePaymentIntentId: payment.stripePaymentIntentId,
    amountCents: toStripeCents(input.refundAmount),
    idempotencyKey: `refund:${randomUUID()}`,
  });

  const updated = await repo.refundServiceVisitPaymentWithAudit(
    payment.id,
    { refundAmount: input.refundAmount, stripeRefundId: refund.id, reason: input.reason },
    { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole }
  );

  if (updated.stripeTaxTransactionId && updated.taxTransactionStatus === "committed") {
    const isFullRefund = updated.status === "refunded";
    try {
      await gateway.reverseTaxTransaction({
        originalTransactionId: updated.stripeTaxTransactionId,
        mode: isFullRefund ? "full" : "partial",
        refundAmountCents: isFullRefund ? undefined : toStripeCents(input.refundAmount),
        reference: `refund-reversal:${updated.id}:${randomUUID()}`,
        idempotencyKey: `tax-reversal:${randomUUID()}`,
      });
    } catch (error) {
      // Best-effort, never rolls back the refund itself — see this
      // function's own doc comment. Logged for manual follow-up; there is
      // currently no dedicated retry queue for a failed reversal (unlike
      // the forward tax-sync path's retryExternalTaxSync), which is a
      // known gap for a future pass.
      console.warn(
        `[payments] Stripe Tax reversal failed for service_visit_payments ${updated.id} (originalTransactionId=${updated.stripeTaxTransactionId}): ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  return updated;
}
