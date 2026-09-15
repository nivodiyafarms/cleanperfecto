import { notFound } from "next/navigation";
import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import StatusBadge from "@/components/admin/StatusBadge";
import { CANCELLATION_POLICY_TIERS } from "@/lib/booking/cancellation-policy";
import { listCleaners } from "@/lib/admin/queries/cleaners";
import { findServiceVisitDetail, listServiceFeeAssessments, listServiceVisitEvents } from "@/lib/admin/queries/service-visits";
import { resolveDurationInputForVisit } from "@/lib/admin/queries/visit-scope";
import { cancelVisitAction, completeVisitAction, reassignCleanersAction, rescheduleVisitAction, waiveFeeAction } from "@/lib/admin/actions/schedule-actions";
import { confirmVisitPricingAction, editRecurringCadenceAction, editRecurringVisitDateAction } from "@/lib/admin/actions/recurring-actions";
import { retryNotificationAction } from "@/lib/admin/actions/notification-actions";
import { resendConsentRequestAction, retrySignedConsentDocumentAction, setReviewRequestSuppressedAction } from "@/lib/admin/actions/consent-actions";
import { recordExternalPaymentAction, refundPaymentAction, retryTaxSyncAction } from "@/lib/admin/actions/payment-actions";
import { formatCadenceLabel, formatInstant, formatMoney, localDateOf, localTimeOf } from "@/lib/admin/format";
import { ADD_ON_CATALOG } from "@/lib/pricing/add-ons";
import { estimateDuration } from "@/lib/scheduling/duration-engine";
import { findAvailableCleaners } from "@/lib/scheduling/find-available-cleaners";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";

const PRICED_ADD_ONS = Object.values(ADD_ON_CATALOG).filter((a) => a.kind !== "manual_quote");
const RECURRING_CADENCE_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "every_4_weeks", label: "Every 4 Weeks" },
];

interface VisitDetailPageProps {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ date?: string; startTime?: string }>;
}

export default async function AdminVisitDetailPage({ params, searchParams }: VisitDetailPageProps) {
  const { visitId } = await params;
  const query = await searchParams;

  const visit = await findServiceVisitDetail(visitId);
  if (!visit) notFound();

  const schedulingRepo = createSupabaseSchedulingRepository();

  const [events, fees, cleaners, durationInput, notifications] = await Promise.all([
    listServiceVisitEvents(visitId),
    listServiceFeeAssessments(visitId),
    listCleaners(),
    resolveDurationInputForVisit(visit),
    schedulingRepo.listServiceVisitNotifications(visitId),
  ]);
  const cleanerNameById = new Map(cleaners.map((c) => [c.id, c.name]));

  const canManage = visit.status === "scheduled";
  const rescheduleDate = query.date || (visit.confirmedStartAt ? localDateOf(visit.confirmedStartAt) : "");
  const rescheduleStartTime = query.startTime || (visit.confirmedStartAt ? localTimeOf(visit.confirmedStartAt) : "");
  const duration = durationInput ? estimateDuration(durationInput) : null;

  const availableCleaners =
    canManage && duration && rescheduleDate && rescheduleStartTime
      ? await findAvailableCleaners(schedulingRepo, {
          date: rescheduleDate,
          startTime: rescheduleStartTime,
          serviceMinutes: duration.estimatedServiceMinutes,
          timezone: visit.timezone,
          excludeServiceVisitId: visitId,
        })
      : null;

  // Universal recurring calendar (recurring_visit_plans) — present for both
  // Pay Per Cleaning and prepaid-package recurring relationships alike. A
  // package's own "change this/this-and-future" UI already lives on
  // /admin/packages/[packageId] (backed by the same universal calendar via
  // the package<->recurring plan link); this section is what gives a
  // Pay Per Cleaning customer's schedule the equivalent capability, since
  // no other admin page lists their upcoming planned occurrences.
  const recurringPlans = visit.recurringScheduleId ? await schedulingRepo.listRecurringVisitPlans(visit.recurringScheduleId) : [];
  const plannedRecurringPlans = recurringPlans.filter((p) => p.status === "planned");

  const isPayPerCleaningRecurringVisit =
    !visit.prepaidPackageId && Boolean(visit.recurringScheduleId) && (visit.status === "requested" || visit.status === "scheduled");
  const visitPricing = isPayPerCleaningRecurringVisit ? await schedulingRepo.findServiceVisitPricingByVisitId(visitId) : null;

  const consentRepo = createSupabaseConsentRepository();
  const activeConsentVersion = await consentRepo.findActiveVersion();
  const consentRecord = activeConsentVersion ? await consentRepo.findByCustomerAndVersion(visit.customerId, activeConsentVersion.id) : null;

  const visitPayment = visit.status === "completed" ? await schedulingRepo.findServiceVisitPaymentByVisitId(visitId) : null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-foreground">Visit — {visit.customerName}</h1>
        <StatusBadge status={visit.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {visit.confirmedStartAt && visit.confirmedEndAt
          ? `${formatInstant(visit.confirmedStartAt)} – ${localTimeOf(visit.confirmedEndAt)}`
          : formatInstant(visit.requestedStartAt)}
        {" · "}
        {formatCadenceLabel(visit.cleaningType)}
        {visit.visitNumber ? ` · Package visit ${visit.visitNumber}` : ""}
      </p>
      {(visit.serviceAddressLine1 || visit.serviceCity) && (
        <p className="text-sm text-muted">
          {[visit.serviceAddressLine1, visit.serviceAddressLine2, visit.serviceCity, visit.serviceState, visit.serviceZip]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
      {visit.assignedCleaners.length > 0 && (
        <p className="text-sm text-muted">Assigned: {visit.assignedCleaners.map((c) => c.cleanerName).join(", ")}</p>
      )}

      {canManage && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Reassign cleaner(s)</h2>
            <ActionForm action={reassignCleanersAction} className="mt-3">
              <input type="hidden" name="visitId" value={visitId} />
              <div className="space-y-1">
                {cleaners.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      name="cleanerIds"
                      value={c.id}
                      defaultChecked={visit.assignedCleaners.some((a) => a.cleanerId === c.id)}
                    />
                    {c.name}
                    {!c.active && " (inactive)"}
                  </label>
                ))}
              </div>
              <button type="submit" className="mt-3 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Update assignment
              </button>
            </ActionForm>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Mark completed</h2>
            <p className="mt-1 text-xs text-muted">
              {visit.prepaidPackageId
                ? "This will consume exactly one package credit. The customer is not charged automatically — they'll review and pay (including any tip) through their own portal, or you can record a Cash/Zelle payment once received."
                : "This does not charge the customer automatically — they'll review and pay (including any tip) through their own portal, or you can record a Cash/Zelle payment once received."}
            </p>
            <ActionForm action={completeVisitAction} className="mt-3">
              <input type="hidden" name="visitId" value={visitId} />
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Mark completed
              </button>
            </ActionForm>
          </div>
        </div>
      )}

      {canManage && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Reschedule</h2>
          <form method="GET" className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="date">
                Date
              </label>
              <input id="date" name="date" type="date" defaultValue={rescheduleDate} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="startTime">
                Start time
              </label>
              <input id="startTime" name="startTime" type="time" defaultValue={rescheduleStartTime} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
              Check availability
            </button>
          </form>

          {availableCleaners && (
            <ActionForm action={rescheduleVisitAction} className="mt-4">
              <input type="hidden" name="visitId" value={visitId} />
              <input type="hidden" name="date" value={rescheduleDate} />
              <input type="hidden" name="startTime" value={rescheduleStartTime} />
              <p className="text-xs text-muted">Choose cleaner(s) for the new time:</p>
              <div className="mt-1 space-y-1">
                {availableCleaners.cleaners.map((c) => (
                  <label key={c.cleanerId} className={`flex items-center gap-2 text-sm ${c.available ? "text-foreground" : "text-muted"}`}>
                    <input type="checkbox" name="cleanerIds" value={c.cleanerId} disabled={!c.available} defaultChecked={c.available && visit.assignedCleaners.some((a) => a.cleanerId === c.cleanerId)} />
                    {cleanerNameById.get(c.cleanerId) ?? c.cleanerId}
                    {!c.available && " (unavailable)"}
                  </label>
                ))}
              </div>
              <button type="submit" className="mt-3 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Confirm new time
              </button>
            </ActionForm>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Cancel visit</h2>
          <div className="mt-2 text-xs text-muted">
            <p className="font-medium text-foreground">Cancellation policy:</p>
            <ul className="mt-1 list-disc pl-4">
              {CANCELLATION_POLICY_TIERS.map((tier) => (
                <li key={tier.window}>
                  {tier.window}: {tier.fee}
                </li>
              ))}
            </ul>
          </div>
          <ActionForm action={cancelVisitAction} className="mt-3">
            <input type="hidden" name="visitId" value={visitId} />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="noAccess" />
              Cleaner was dispatched / no access at the property
            </label>
            <label className="mt-2 block text-xs font-medium text-muted" htmlFor="reason">
              Reason (optional)
            </label>
            <input id="reason" name="reason" type="text" className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm" />
            <button type="submit" className="mt-3 rounded-lg border border-red-300 px-4 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50">
              Cancel this visit
            </button>
          </ActionForm>
        </div>
      )}

      {fees.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Fee assessments</h2>
          <ul className="mt-3 space-y-3">
            {fees.map((fee) => (
              <li key={fee.id} className="text-sm">
                <p className="text-foreground">
                  {formatMoney(fee.amount)} — {fee.feeType} ({fee.state})
                </p>
                {fee.reason && <p className="text-muted">{fee.reason}</p>}
                {fee.state === "assessed" && (
                  <ActionForm action={waiveFeeAction} className="mt-1">
                    <input type="hidden" name="feeAssessmentId" value={fee.id} />
                    <input type="hidden" name="visitId" value={visitId} />
                    <div className="flex flex-wrap items-center gap-2">
                      <input name="reason" type="text" placeholder="Reason for waiving" className="rounded-lg border border-border px-2 py-1 text-xs" required />
                      <button type="submit" className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                        Waive
                      </button>
                    </div>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isPayPerCleaningRecurringVisit && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Confirm final price (Pay Per Cleaning)</h2>
          {visitPricing && (
            <p className="mt-1 text-xs text-muted">
              Current estimate: {formatMoney(visitPricing.totalAmount)} — {visitPricing.priceStatus}
              {visitPricing.requiresCustomerApproval ? " (awaiting customer approval on the last increase)" : ""}
            </p>
          )}
          <ActionForm action={confirmVisitPricingAction} className="mt-3 space-y-2">
            <input type="hidden" name="serviceVisitId" value={visitId} />
            <div className="flex flex-wrap gap-3">
              {PRICED_ADD_ONS.map((addOn) => (
                <label key={addOn.id} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input type="checkbox" name="addOnIds" value={addOn.id} defaultChecked={visitPricing?.addOnIds.includes(addOn.id)} />
                  {addOn.label} ({formatMoney(addOn.amount ?? 0)})
                </label>
              ))}
            </div>
            <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Confirm final price
            </button>
          </ActionForm>
        </div>
      )}

      {visitPayment && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Payment</h2>
          <dl className="mt-2 space-y-1 text-xs text-muted">
            <div>Approved service/extras: {formatMoney(visitPayment.approvedAmount)}</div>
            {visitPayment.tipAmount !== null && <div>Customer tip: {formatMoney(visitPayment.tipAmount)}</div>}
            {visitPayment.taxAmount !== null && <div>Tax: {formatMoney(visitPayment.taxAmount)}</div>}
            {visitPayment.totalAmount !== null && <div>Total charged: {formatMoney(visitPayment.totalAmount)}</div>}
            <div>Payment status: {visitPayment.status}</div>
            {visitPayment.paymentMethodType && (
              <div>
                Method: {visitPayment.paymentMethodType === "stripe_card" ? `Card${visitPayment.cardBrand ? ` — ${visitPayment.cardBrand} •••• ${visitPayment.cardLast4}` : ""}` : visitPayment.paymentMethodType === "zelle" ? "Zelle" : "Cash"}
              </div>
            )}
            {visitPayment.externalPaymentReference && <div>Reference: {visitPayment.externalPaymentReference}</div>}
            {visitPayment.stripePaymentIntentId && <div>Stripe PaymentIntent: {visitPayment.stripePaymentIntentId}</div>}
            {visitPayment.stripeTaxCalculationId && <div>Stripe Tax Calculation: {visitPayment.stripeTaxCalculationId}</div>}
            {visitPayment.stripeTaxTransactionId && <div>Stripe Tax Transaction: {visitPayment.stripeTaxTransactionId}</div>}
            <div>Tax sync status: {visitPayment.taxTransactionStatus}</div>
            {visitPayment.taxTransactionFailureMessage && <div className="text-red-600">Tax sync issue: {visitPayment.taxTransactionFailureMessage}</div>}
            {visitPayment.failureMessage && <div className="text-red-600">Payment failure: {visitPayment.failureMessage}</div>}
            {visitPayment.refundedAmount > 0 && <div>Refunded: {formatMoney(visitPayment.refundedAmount)}</div>}
          </dl>

          {visitPayment.status === "created" && visitPayment.tipSelectionType && (
            <ActionForm action={recordExternalPaymentAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="serviceVisitId" value={visitId} />
              <select name="paymentMethodType" className="rounded-lg border border-border px-3 py-1.5 text-sm">
                <option value="zelle">Zelle</option>
                <option value="cash">Cash</option>
              </select>
              <input name="externalPaymentReference" placeholder="Reference (optional)" className="rounded-lg border border-border px-3 py-1.5 text-sm" />
              <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                Record External Payment
              </button>
            </ActionForm>
          )}

          {visitPayment.status === "paid" && (visitPayment.taxTransactionStatus === "pending" || visitPayment.taxTransactionStatus === "failed") && (
            <ActionForm action={retryTaxSyncAction} className="mt-3">
              <input type="hidden" name="serviceVisitPaymentId" value={visitPayment.id} />
              <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                Retry Tax Sync
              </button>
            </ActionForm>
          )}

          {(visitPayment.status === "paid" || visitPayment.status === "partially_refunded") && (
            <ActionForm action={refundPaymentAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="serviceVisitId" value={visitId} />
              <input name="refundAmount" type="number" step="0.01" min="0.01" placeholder="Refund amount" required className="w-32 rounded-lg border border-border px-3 py-1.5 text-sm" />
              <input name="reason" type="text" placeholder="Reason for refund" required className="rounded-lg border border-border px-3 py-1.5 text-sm" />
              <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                Issue Refund
              </button>
            </ActionForm>
          )}
        </div>
      )}

      {plannedRecurringPlans.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Upcoming planned occurrences</h2>
          <p className="mt-1 text-xs text-muted">
            From this recurring schedule&apos;s universal calendar — not yet real appointments.
          </p>
          <ul className="mt-3 space-y-2">
            {plannedRecurringPlans.map((plan) => (
              <li key={plan.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-foreground">
                  Visit #{plan.visitNumber} — {plan.plannedDate} at {plan.plannedStartTime}
                </p>
                <ActionForm action={editRecurringVisitDateAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="recurringVisitPlanId" value={plan.id} />
                  <div>
                    <label className="block text-xs text-muted">New date</label>
                    <input name="date" type="date" defaultValue={plan.plannedDate} className="mt-1 rounded-md border border-border px-2 py-1 text-xs" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted">New time</label>
                    <input name="startTime" type="time" defaultValue={plan.plannedStartTime} className="mt-1 rounded-md border border-border px-2 py-1 text-xs" />
                  </div>
                  <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                    Change this occurrence
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-xs font-semibold text-foreground">Change this and future</h3>
            <ActionForm action={editRecurringCadenceAction} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="recurringScheduleId" value={visit.recurringScheduleId ?? ""} />
              <div>
                <label className="block text-xs font-medium text-muted" htmlFor="effectiveFromVisitNumber">
                  Starting at visit #
                </label>
                <select id="effectiveFromVisitNumber" name="effectiveFromVisitNumber" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                  {plannedRecurringPlans.map((p) => (
                    <option key={p.id} value={p.visitNumber}>
                      {p.visitNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted" htmlFor="newCadence">
                  New cadence
                </label>
                <select id="newCadence" name="newCadence" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                  {RECURRING_CADENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted" htmlFor="newFirstDate">
                  New first date
                </label>
                <input id="newFirstDate" name="newFirstDate" type="date" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted" htmlFor="newFirstStartTime">
                  Start time
                </label>
                <input id="newFirstStartTime" name="newFirstStartTime" type="time" defaultValue="10:00" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
              </div>
              <button type="submit" className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                Update dates only
              </button>
            </ActionForm>
          </div>
        </div>
      )}

      {activeConsentVersion && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Consent</h2>
          {consentRecord ? (
            <>
              <p className="mt-2 text-sm text-foreground">
                {consentRecord.state === "signed" ? (
                  <span className="font-medium text-emerald-700">Signed</span>
                ) : (
                  <span className="font-medium text-amber-700">Action Required — {consentRecord.state}</span>
                )}
                {" · "}version {activeConsentVersion.versionLabel}
              </p>
              <p className="mt-1 text-xs text-muted">
                Sent {formatInstant(consentRecord.sentAt.toISOString())}
                {consentRecord.viewedAt ? ` · Viewed ${formatInstant(consentRecord.viewedAt.toISOString())}` : ""}
                {consentRecord.declinedAt ? ` · Declined ${formatInstant(consentRecord.declinedAt.toISOString())}` : ""}
                {consentRecord.signedAt ? ` · Signed ${formatInstant(consentRecord.signedAt.toISOString())}` : ""}
              </p>
              {consentRecord.state === "signed" && (
                <div className="mt-3 space-y-2">
                  <details className="rounded-lg border border-border p-3 text-xs text-foreground">
                    <summary className="cursor-pointer font-medium">View Signed Consent</summary>
                    <p className="mt-2 whitespace-pre-wrap text-muted">Signed by: {consentRecord.signedName}</p>
                    <p className="mt-2 whitespace-pre-wrap">{consentRecord.acceptedTextSnapshot}</p>
                  </details>
                  {consentRecord.signedDocumentPath ? (
                    <a
                      href={`/admin/consent/${consentRecord.id}/document`}
                      className="inline-block rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt"
                    >
                      Download Signed PDF
                    </a>
                  ) : (
                    <ActionForm action={retrySignedConsentDocumentAction}>
                      <input type="hidden" name="consentId" value={consentRecord.id} />
                      <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                        Generate signed document
                      </button>
                    </ActionForm>
                  )}
                </div>
              )}
              {consentRecord.state !== "signed" && (
                <ActionForm action={resendConsentRequestAction} className="mt-3">
                  <input type="hidden" name="customerId" value={visit.customerId} />
                  <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                    Resend consent request
                  </button>
                </ActionForm>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-amber-700">Action Required — not sent</p>
          )}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Review request</h2>
        <p className="mt-1 text-xs text-muted">
          {visit.status === "completed"
            ? "Suppress the automated review request for this specific visit (e.g. a problem/unhappy cleaning)."
            : "Available once this visit is completed."}
        </p>
        <ActionForm action={setReviewRequestSuppressedAction} className="mt-2">
          <input type="hidden" name="serviceVisitId" value={visitId} />
          <input type="hidden" name="suppressed" value={(!visit.reviewRequestSuppressed).toString()} />
          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
            {visit.reviewRequestSuppressed ? "Remove suppression" : "Suppress review request"}
          </button>
        </ActionForm>
        {visit.reviewRequestSuppressed && <p className="mt-1 text-xs text-red-600">Currently suppressed.</p>}
      </div>

      {notifications.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {notifications.map((n) => (
              <li key={n.id} className="rounded-lg border border-border p-3">
                <p className="text-foreground">
                  <span className="font-medium">{n.notificationType.replace(/_/g, " ")}</span> · {n.channel} · {n.state}
                </p>
                <p className="text-xs text-muted">
                  Scheduled {formatInstant(n.scheduledSendAt.toISOString())}
                  {n.sentAt ? ` · Sent ${formatInstant(n.sentAt.toISOString())}` : ""}
                  {n.retryCount > 0 ? ` · ${n.retryCount} attempt${n.retryCount === 1 ? "" : "s"}` : ""}
                </p>
                {n.failureReason && <p className="text-xs text-red-600">{n.failureReason}</p>}
                {n.state === "failed" && (
                  <ActionForm action={retryNotificationAction} className="mt-2">
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                      Retry
                    </button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">History</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No history yet.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {events.map((event) => (
              <li key={event.id} className="text-foreground">
                <span className="font-medium">{event.eventType.replace(/_/g, " ")}</span>{" "}
                <span className="text-muted">{formatInstant(event.occurredAt)}</span>
                {event.actor && <span className="text-muted"> · {event.actor}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {visit.prepaidPackageId && (
        <p className="mt-6 text-sm">
          <Link href={`/admin/packages/${visit.prepaidPackageId}`} className="font-medium text-secondary hover:underline">
            View package →
          </Link>
        </p>
      )}
    </div>
  );
}
