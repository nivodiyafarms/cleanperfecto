import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ServiceFeeAssessmentRow } from "@/lib/scheduling/domain-types";
import { assertCanRecordExternalPayment } from "@/lib/config/payment-capabilities";

export interface CollectServiceFeeExternallyInput {
  feeAssessmentId: string;
  collectionMethod: "zelle" | "cash";
  externalPaymentReference: string | null;
  actorAdminUserId: string;
  actorRole: string;
}

/**
 * Admin "Record Fee Collection" (external rail only — zelle/cash) — Phase
 * H, the third and previously entirely unbuilt concept alongside
 * assessment (cancel-service-visit.ts) and waiver (waiveFeeAction).
 *
 * Same "record what already happened" semantics as record-external-
 * payment.ts: the amount is never admin-entered (it is the assessment's
 * own frozen `amount`), and there is no in-between "collection attempt"
 * state — the admin only records this AFTER money has already changed
 * hands, so a payment that never actually happened simply never reaches
 * this function, leaving the assessment untouched at state='assessed'.
 *
 * Deliberately touches only service_fee_assessments and
 * financial_audit_log (via collectServiceFeeAssessmentWithAudit) — never
 * service_visit_payments or prepaid_packages. A cancellation fee is an
 * independent per-visit financial fact and must never be silently netted
 * against a package refund or a visit's own cleaning charge (the
 * finalized Phase G policy).
 *
 * Stripe settlement (collection_method='stripe_card') is intentionally
 * NOT a path this function offers — this milestone has no off-session/
 * automated-charge Stripe gateway capability to call, and PAYMENT_MODE is
 * disabled. The schema (collect_service_fee_assessment_with_audit,
 * service_fee_assessments.collection_method) already allows that value so
 * a future Stripe collection path can be added without another migration,
 * but building that gateway capability is a separate, not-yet-authorized
 * decision.
 */
export async function collectServiceFeeExternally(repo: SchedulingRepository, input: CollectServiceFeeExternallyInput): Promise<ServiceFeeAssessmentRow> {
  assertCanRecordExternalPayment();

  return repo.collectServiceFeeAssessmentWithAudit(
    input.feeAssessmentId,
    { collectionMethod: input.collectionMethod, externalPaymentReference: input.externalPaymentReference, stripePaymentIntentId: null },
    { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole }
  );
}
