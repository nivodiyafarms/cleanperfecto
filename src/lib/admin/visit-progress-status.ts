import type { ServiceVisitPaymentStatus, ServiceVisitPricingPriceStatus, ServiceVisitStatus } from "@/lib/scheduling/types";

export type VisitProgressStatus =
  | "requested"
  | "scheduled"
  | "work_finished"
  | "final_price_pending"
  | "final_total_sent"
  | "awaiting_customer"
  | "payment_requires_action"
  | "paid"
  | "cancelled";

const LABELS: Record<VisitProgressStatus, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  work_finished: "Work Finished",
  final_price_pending: "Final Price Pending",
  final_total_sent: "Final Total Sent",
  awaiting_customer: "Awaiting Customer",
  payment_requires_action: "Payment Requires Action",
  paid: "Paid",
  cancelled: "Cancelled",
};

export function formatVisitProgressStatusLabel(status: VisitProgressStatus): string {
  return LABELS[status];
}

export interface ComputeVisitProgressStatusInput {
  visitStatus: ServiceVisitStatus;
  /** null when no service_visit_pricing row exists yet. */
  priceStatus: ServiceVisitPricingPriceStatus | null;
  /** Whether a final_total_ready notification has ever been enqueued for this visit (Finalize & Send or Resend). */
  finalTotalSent: boolean;
  /** null when no service_visit_payments row exists yet. */
  paymentStatus: ServiceVisitPaymentStatus | null;
}

/**
 * A purely computed, DISPLAY-ONLY progression label for the admin visit
 * page — never persisted, never a new state machine. Derived entirely from
 * service_visits.status, service_visit_pricing.price_status, whether a
 * final_total_ready notification exists, and service_visit_payments.status
 * — the three state machines this milestone already reuses unchanged (see
 * finalize-and-send.ts). Gives admin the single at-a-glance progression the
 * spec asks for (Scheduled -> Work Finished -> Final price pending ->
 * Final Total sent -> Awaiting customer -> Payment requires action -> Paid)
 * without inventing a fourth persisted status column.
 */
export function computeVisitProgressStatus(input: ComputeVisitProgressStatusInput): VisitProgressStatus {
  if (input.visitStatus === "requested") return "requested";
  if (input.visitStatus === "cancelled") return "cancelled";
  if (input.visitStatus === "scheduled") return "scheduled";

  if (input.visitStatus === "work_finished") {
    return input.finalTotalSent ? "awaiting_customer" : "final_price_pending";
  }

  // visitStatus === "completed" from here on.
  switch (input.paymentStatus) {
    case "paid":
    case "no_payment_due":
    case "refunded":
    case "partially_refunded":
      return "paid";
    case "requires_action":
    case "payment_failed":
      return "payment_requires_action";
    case "processing":
    case "created":
      return "awaiting_customer";
    default:
      return input.finalTotalSent ? "final_total_sent" : "awaiting_customer";
  }
}
