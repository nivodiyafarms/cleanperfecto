import type Stripe from "stripe";
import { bootstrapRecurringVisitPlansFromDirectVisit } from "@/lib/scheduling/bootstrap-recurring-visit-plans-from-direct-visit";
import { createRequestedVisitFromBooking } from "@/lib/scheduling/create-requested-visit-from-booking";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { RecurringCadence } from "@/lib/scheduling/types";
import { enqueueConsentRequest } from "@/lib/consent/enqueue-consent-request";
import type { ConsentRepository } from "@/lib/consent/consent-repository";
import { type PaymentMode, resolvePaymentMode } from "@/lib/config/runtime-env";
import { sendNormalBookingConfirmationEmails } from "../email/send-normal-booking-confirmation-emails";
import { sendPrepaidPackageSuccessEmails } from "../email/send-prepaid-package-success-emails";
import type { BookingRepository } from "../repository";
import type { PrepaidFrequency } from "../types";
import { reconcileVisitPayment, reconcileVisitPaymentRefund } from "@/lib/payments/reconcile-visit-payment";
import type { VisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { issueDocumentsForPackagePurchase } from "@/lib/invoicing/issue-documents-for-package-purchase";
import { formatPaymentMethodDisplayFromStripe } from "@/lib/invoicing/format-payment-method-display";
import { resolveWebhookFulfillmentDecision } from "./webhook-fulfillment-guard";

const PREPAID_FREQUENCIES = new Set<PrepaidFrequency>(["weekly", "biweekly", "every_4_weeks"]);

function bookingOrderIdFromSession(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.booking_order_id ?? null;
}

function intentIdOf(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Captures which PaymentMethod a succeeded SetupIntent actually resulted
 * in — Payments V1's fix for a gap in the original booking setup flow,
 * which retrieved the SetupIntent but never read/persisted `.payment_method`
 * anywhere. This is the one thing that makes a later post-completion Pay
 * Per Cleaning charge (or Update Payment Method) possible: the authoritative
 * saved PaymentMethod, resolved server-side from a VERIFIED succeeded
 * SetupIntent, never from anything client-supplied. Best-effort (never
 * throws) — a failure here must never turn a successful setup into a
 * failed webhook delivery.
 */
async function capturePaymentMethodFromSetupIntent(stripe: Stripe, repo: BookingRepository, customerId: string, setupIntent: Stripe.SetupIntent): Promise<void> {
  const paymentMethodId = intentIdOf(setupIntent.payment_method as string | { id: string } | null);
  if (!paymentMethodId) return;

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  await repo.setCustomerDefaultPaymentMethod(customerId, {
    stripePaymentMethodId: paymentMethodId,
    brand: paymentMethod.card?.brand ?? null,
    last4: paymentMethod.card?.last4 ?? null,
    expMonth: paymentMethod.card?.exp_month ?? null,
    expYear: paymentMethod.card?.exp_year ?? null,
  });

  const stripeCustomerId = intentIdOf(setupIntent.customer as string | { id: string } | null);
  if (stripeCustomerId) {
    await stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  }
}

/**
 * A setup-mode Checkout Session created by the customer-portal Update
 * Payment Method flow (see src/lib/payments/create-payment-method-setup.ts)
 * — tagged `metadata.purpose = 'update_payment_method'` specifically so
 * this branch never requires (or looks for) a booking_order_id. Any
 * pending visit-payment tip selection is untouched by this entirely
 * (nothing here writes to service_visit_payments).
 */
async function handlePaymentMethodUpdateSetupCompleted(stripe: Stripe, repo: BookingRepository, session: Stripe.Checkout.Session): Promise<void> {
  const setupIntentId = intentIdOf(session.setup_intent);
  const customerId = session.metadata?.customer_id ?? null;
  if (!setupIntentId || !customerId) return;

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (setupIntent.status !== "succeeded") return;

  await capturePaymentMethodFromSetupIntent(stripe, repo, customerId, setupIntent);
}

/**
 * Setup mode: confirming payment method setup, never payment. Only a
 * verified SetupIntent status of 'succeeded' moves the booking order to
 * pending_confirmation — bare checkout.session.completed is not
 * sufficient (see the approved plan's §3).
 *
 * Scheduling integration point (Scheduling + Package Management milestone):
 * once setup succeeds, creates the initial 'requested' service_visits row
 * for this normal booking — see create-requested-visit-from-booking.ts.
 * Deliberately called BEFORE the booking_orders status transition below,
 * not after: create-requested-visit-from-booking.ts is itself idempotent
 * (safe to call again), so if it succeeds here but the status update fails/
 * retries, a Stripe retry's call to this function is a harmless no-op while
 * the status update proceeds normally. Doing it in the other order would
 * mean a visit-creation failure on the FIRST attempt could never be
 * retried — a later retry finds status already advanced and, since
 * updateBookingOrderStatus's `changed` gate below only fires on the run
 * that performs the real transition, would silently skip visit creation
 * forever. schedulingRepo is optional so existing tests that don't care
 * about scheduling behavior are unaffected; the production route always
 * supplies it (see src/app/api/stripe/webhook/route.ts).
 */
async function handleSetupSessionCompleted(
  stripe: Stripe,
  repo: BookingRepository,
  session: Stripe.Checkout.Session,
  bookingOrderId: string,
  schedulingRepo?: SchedulingRepository,
  consentRepo?: ConsentRepository
): Promise<void> {
  const setupIntentId = intentIdOf(session.setup_intent);
  if (!setupIntentId) return;

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (setupIntent.status !== "succeeded") {
    // Not yet — leave the attempt as-is; a later event (or Stripe retry of
    // this same event, per the claim-webhook-event crash-recovery design)
    // will re-check.
    return;
  }

  await repo.updatePaymentAttemptBySessionId(session.id, {
    status: "completed",
    stripeSetupIntentId: setupIntentId,
  });

  let customerId: string | null = null;
  let directVisitId: string | null = null;

  // Payments V1: capture the resulting PaymentMethod regardless of whether
  // schedulingRepo is wired — best-effort, never blocks the existing
  // booking-confirmation flow below.
  const bookingOrderForPaymentMethod = await repo.findBookingOrderById(bookingOrderId);
  if (bookingOrderForPaymentMethod) {
    await capturePaymentMethodFromSetupIntent(stripe, repo, bookingOrderForPaymentMethod.customerId, setupIntent).catch(() => {});
  }

  if (schedulingRepo) {
    const bookingOrder = await repo.findBookingOrderById(bookingOrderId);
    if (bookingOrder && bookingOrder.bookingType === "normal" && bookingOrder.requestedDate && bookingOrder.requestedStartTime) {
      customerId = bookingOrder.customerId;
      const { visitId, recurringScheduleId } = await createRequestedVisitFromBooking(schedulingRepo, {
        bookingOrderId: bookingOrder.id,
        customerId: bookingOrder.customerId,
        quoteRequestId: bookingOrder.quoteRequestId,
        cleaningType: bookingOrder.cleaningType,
        frequency: bookingOrder.frequency,
        requestedDate: bookingOrder.requestedDate,
        requestedStartTime: bookingOrder.requestedStartTime,
        serviceAddressLine1: bookingOrder.serviceAddressLine1,
        serviceAddressLine2: bookingOrder.serviceAddressLine2,
        serviceCity: bookingOrder.serviceCity,
        serviceState: bookingOrder.serviceState,
        serviceAddressIdentity: bookingOrder.serviceAddressIdentity,
      });
      directVisitId = visitId;

      // Recurring frequency only — one_time bookings get no recurring_schedule
      // at all (createRequestedVisitFromBooking returns null for those), so
      // there is no universal next-six calendar to seed. Seeds the
      // customer/admin calendar's first six slots (slot #1 already 'linked'
      // to the direct visit just created above) — never creates any
      // additional real service_visits.
      if (recurringScheduleId) {
        await bootstrapRecurringVisitPlansFromDirectVisit(schedulingRepo, {
          recurringScheduleId,
          customerId: bookingOrder.customerId,
          cadence: bookingOrder.frequency as RecurringCadence,
          firstDate: bookingOrder.requestedDate,
          firstStartTime: bookingOrder.requestedStartTime,
          directServiceVisitId: visitId,
        });
      }
    }
  }

  const changed = await repo.updateBookingOrderStatus(bookingOrderId, "awaiting_payment_method", "pending_confirmation");
  if (changed) {
    // Best-effort, same convention as the rest of the codebase (Promise
    // rejection here must never turn a successful setup into a failed
    // webhook delivery / Stripe retry loop).
    await sendNormalBookingConfirmationEmails(repo, bookingOrderId).catch(() => {});

    // Consent request — "send after booking confirmation," using the real
    // direct visit as its informational link. Idempotent via
    // customer_consents' own unique constraint, so a Stripe retry (this
    // whole branch re-running) can never create a duplicate request.
    if (schedulingRepo && consentRepo && customerId) {
      await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId, serviceVisitId: directVisitId }).catch(() => {});
    }
  }
}

/**
 * Payment mode: only session.payment_status === "paid" (optionally
 * cross-verified against the PaymentIntent) counts as a verified payment.
 * Activation is independently idempotent via prepaid_packages'
 * booking_order_id UNIQUE constraint — a redelivered/duplicate event can
 * never create a second package.
 */
async function finalizeVerifiedPayment(
  stripe: Stripe,
  repo: BookingRepository,
  session: Stripe.Checkout.Session,
  bookingOrderId: string,
  schedulingRepo?: SchedulingRepository,
  consentRepo?: ConsentRepository
): Promise<void> {
  const paymentIntentId = intentIdOf(session.payment_intent);
  let paymentMethod: Stripe.PaymentMethod | null = null;
  if (paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] });
    if (paymentIntent.status !== "succeeded") {
      return;
    }
    paymentMethod = (paymentIntent.payment_method as Stripe.PaymentMethod | null) ?? null;
  }

  await repo.updatePaymentAttemptBySessionId(session.id, {
    status: "completed",
    ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
  });

  const bookingOrder = await repo.findBookingOrderById(bookingOrderId);
  if (
    !bookingOrder ||
    bookingOrder.bookingType !== "prepaid_package" ||
    bookingOrder.prepaidPackageTotal === null ||
    bookingOrder.effectivePricePerVisit === null ||
    !PREPAID_FREQUENCIES.has(bookingOrder.frequency as PrepaidFrequency)
  ) {
    return;
  }

  const { inserted } = await repo.activatePrepaidPackage({
    customerId: bookingOrder.customerId,
    bookingOrderId: bookingOrder.id,
    frequency: bookingOrder.frequency as PrepaidFrequency,
    packageTotalPaid: bookingOrder.prepaidPackageTotal,
    effectivePricePerVisit: bookingOrder.effectivePricePerVisit,
  });

  const changed = await repo.updateBookingOrderStatus(bookingOrderId, "awaiting_payment", "payment_completed");

  if (inserted && changed) {
    await sendPrepaidPackageSuccessEmails(repo, bookingOrderId).catch(() => {});

    // Best-effort — issuing the invoice/receipt paperwork must never be
    // mistaken for (or roll back) the package activation itself, which
    // already committed above.
    if (schedulingRepo) {
      const purchasedPackage = await schedulingRepo.findPrepaidPackageByBookingOrderId(bookingOrderId);
      if (purchasedPackage) {
        const paymentMethodDisplay = formatPaymentMethodDisplayFromStripe(paymentMethod);
        await issueDocumentsForPackagePurchase(schedulingRepo, purchasedPackage, paymentMethodDisplay, paymentIntentId).catch((error) => {
          console.error(`[booking] failed to issue invoice/receipt for prepaid_packages ${purchasedPackage.id}:`, error);
        });
      }
    }

    // Consent request — no real service_visit exists yet for a package at
    // this point (package visit slots start 'planned', not 'linked', until
    // each is individually scheduled later), so this is the one case
    // consent_required is enqueued with serviceVisitId=null. Idempotent via
    // customer_consents' own unique constraint.
    if (schedulingRepo && consentRepo) {
      await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: bookingOrder.customerId, serviceVisitId: null }).catch(() => {});
    }
  }
}

async function handlePaymentSessionCompleted(
  stripe: Stripe,
  repo: BookingRepository,
  session: Stripe.Checkout.Session,
  bookingOrderId: string,
  schedulingRepo?: SchedulingRepository,
  consentRepo?: ConsentRepository
): Promise<void> {
  if (session.payment_status !== "paid") {
    // Delayed/async payment method still settling — do not activate yet.
    // checkout.session.async_payment_succeeded / _failed resolves this.
    await repo.updatePaymentAttemptBySessionId(session.id, { status: "processing" });
    return;
  }
  await finalizeVerifiedPayment(stripe, repo, session, bookingOrderId, schedulingRepo, consentRepo);
}

/**
 * Dispatches a verified Stripe webhook event to the correct fulfillment
 * path. Called only after claimWebhookEvent has confirmed this delivery
 * needs (re)processing — see the route handler. Throws on unexpected
 * failure so the caller can mark the ledger row 'failed' and return a 5xx,
 * letting Stripe's own retry schedule redeliver the event; never writes to
 * quote_requests (booking_orders/payment_attempts/prepaid_packages are
 * this milestone's source of truth).
 */
export async function processStripeWebhookEvent(
  stripe: Stripe,
  repo: BookingRepository,
  event: Stripe.Event,
  schedulingRepo?: SchedulingRepository,
  consentRepo?: ConsentRepository,
  paymentGateway?: VisitPaymentGateway,
  paymentMode: PaymentMode = resolvePaymentMode()
): Promise<void> {
  // Checked once, before any dispatch — see webhook-fulfillment-guard.ts.
  // A denied decision is a safe no-op: the caller (route.ts) already
  // recorded this verified event in the audit ledger (full payload,
  // including event.livemode) and will still mark it 'processed' — the
  // cleanest state this ledger's existing received/processing/processed/
  // failed machine supports for "seen, deliberately not acted on," and the
  // only one that both returns success to Stripe (no retry storm over a
  // decision we will never revisit) and permanently forbids that exact
  // event id from later reaching fulfillment on any redelivery, including
  // one arriving after PAYMENT_MODE changes (claimWebhookEvent only ever
  // reprocesses a 'received' or 'failed' row, never 'processed'). The
  // warning below is an operational log only, not a ledger column change,
  // so an operator can see WHY a given delivery was skipped in real time.
  const fulfillmentDecision = resolveWebhookFulfillmentDecision(paymentMode, event);
  if (!fulfillmentDecision.allowed) {
    console.warn(
      `[stripe-webhook] skipped fulfillment for ${event.type} (eventId=${event.id}, livemode=${event.livemode}, PAYMENT_MODE=${paymentMode}): ${fulfillmentDecision.reason}`
    );
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      if (session.mode === "setup" && session.metadata?.purpose === "update_payment_method") {
        await handlePaymentMethodUpdateSetupCompleted(stripe, repo, session);
        return;
      }

      const bookingOrderId = bookingOrderIdFromSession(session);
      if (!bookingOrderId) return;

      if (session.mode === "setup") {
        await handleSetupSessionCompleted(stripe, repo, session, bookingOrderId, schedulingRepo, consentRepo);
      } else if (session.mode === "payment") {
        await handlePaymentSessionCompleted(stripe, repo, session, bookingOrderId, schedulingRepo, consentRepo);
      }
      return;
    }

    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const bookingOrderId = bookingOrderIdFromSession(session);
      if (!bookingOrderId || session.payment_status !== "paid") return;
      await finalizeVerifiedPayment(stripe, repo, session, bookingOrderId, schedulingRepo, consentRepo);
      return;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      await repo.updatePaymentAttemptBySessionId(session.id, { status: "failed" });
      return;
    }

    case "checkout.session.expired": {
      const session = event.data.object;
      await repo.updatePaymentAttemptBySessionId(session.id, { status: "expired" });
      return;
    }

    case "payment_intent.processing":
    case "payment_intent.requires_action":
    case "payment_intent.payment_failed":
    case "payment_intent.succeeded": {
      if (!schedulingRepo || !paymentGateway) return;
      const intent = event.data.object;
      const statusByEventType = {
        "payment_intent.processing": "processing",
        "payment_intent.requires_action": "requires_action",
        "payment_intent.payment_failed": "payment_failed",
        "payment_intent.succeeded": "paid",
      } as const;
      await reconcileVisitPayment(schedulingRepo, paymentGateway, {
        stripePaymentIntentId: intent.id,
        status: statusByEventType[event.type],
        failureCode: intent.last_payment_error?.code ?? null,
        failureMessage: intent.last_payment_error?.message ?? null,
      });
      return;
    }

    case "payment_intent.canceled": {
      // A canceled PaymentIntent is, from the collections/scheduling
      // perspective, indistinguishable from any other "this attempt did
      // not result in payment" outcome — reuses the existing
      // payment_failed status (distinguished via failureCode/failureMessage)
      // rather than inventing a new DB status. Reconciliation's own
      // transition guard (payment-status-transitions.ts) still applies, so
      // a cancellation event arriving after the intent already succeeded/
      // refunded elsewhere is safely ignored, never a regression.
      if (!schedulingRepo || !paymentGateway) return;
      const intent = event.data.object;
      await reconcileVisitPayment(schedulingRepo, paymentGateway, {
        stripePaymentIntentId: intent.id,
        status: "payment_failed",
        failureCode: intent.cancellation_reason ?? "canceled",
        failureMessage: "Payment was canceled.",
      });
      return;
    }

    case "charge.refunded": {
      if (!schedulingRepo) return;
      const charge = event.data.object;
      const paymentIntentId = intentIdOf(charge.payment_intent as string | { id: string } | null);
      if (!paymentIntentId) return;
      await reconcileVisitPaymentRefund(schedulingRepo, {
        stripePaymentIntentId: paymentIntentId,
        refundedAmountCents: charge.amount_refunded,
        chargeAmountCents: charge.amount,
      });
      return;
    }

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      if (!schedulingRepo) return;
      const dispute = event.data.object;
      const chargeId = intentIdOf(dispute.charge as string | { id: string } | null);
      if (!chargeId) return;
      await schedulingRepo.upsertStripeDisputeEvent({
        stripeDisputeId: dispute.id,
        stripeChargeId: chargeId,
        stripePaymentIntentId: intentIdOf(dispute.payment_intent as string | { id: string } | null),
        amount: dispute.amount / 100,
        currency: dispute.currency,
        disputeStatus: dispute.status,
        reason: dispute.reason ?? null,
        stripeCreatedAt: new Date(dispute.created * 1000),
        stripeEventId: event.id,
        stripeEventCreatedAt: new Date(event.created * 1000),
        // Authoritative per Stripe's own event semantics (see
        // ChargeDisputeClosedEvent's doc comment: "Occurs when a dispute is
        // closed and the dispute status changes to lost, warning_closed, or
        // won") — the event TYPE determines closure, not a locally
        // re-derived guess at which status strings mean "closed".
        isClosed: event.type === "charge.dispute.closed",
      });
      return;
    }

    default:
      // Explicit no-op — this event type carries no domain action for
      // this milestone. Still marked 'processed' by the caller so it
      // isn't reprocessed on redelivery.
      return;
  }
}
