import type Stripe from "stripe";
import { createRequestedVisitFromBooking } from "@/lib/scheduling/create-requested-visit-from-booking";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { sendNormalBookingConfirmationEmails } from "../email/send-normal-booking-confirmation-emails";
import { sendPrepaidPackageSuccessEmails } from "../email/send-prepaid-package-success-emails";
import type { BookingRepository } from "../repository";
import type { PrepaidFrequency } from "../types";

const PREPAID_FREQUENCIES = new Set<PrepaidFrequency>(["weekly", "biweekly", "every_4_weeks"]);

function bookingOrderIdFromSession(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.booking_order_id ?? null;
}

function intentIdOf(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
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
  schedulingRepo?: SchedulingRepository
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

  if (schedulingRepo) {
    const bookingOrder = await repo.findBookingOrderById(bookingOrderId);
    if (bookingOrder && bookingOrder.bookingType === "normal" && bookingOrder.requestedDate && bookingOrder.requestedStartTime) {
      await createRequestedVisitFromBooking(schedulingRepo, {
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
    }
  }

  const changed = await repo.updateBookingOrderStatus(bookingOrderId, "awaiting_payment_method", "pending_confirmation");
  if (changed) {
    // Best-effort, same convention as the rest of the codebase (Promise
    // rejection here must never turn a successful setup into a failed
    // webhook delivery / Stripe retry loop).
    await sendNormalBookingConfirmationEmails(repo, bookingOrderId).catch(() => {});
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
  bookingOrderId: string
): Promise<void> {
  const paymentIntentId = intentIdOf(session.payment_intent);
  if (paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== "succeeded") {
      return;
    }
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
  }
}

async function handlePaymentSessionCompleted(
  stripe: Stripe,
  repo: BookingRepository,
  session: Stripe.Checkout.Session,
  bookingOrderId: string
): Promise<void> {
  if (session.payment_status !== "paid") {
    // Delayed/async payment method still settling — do not activate yet.
    // checkout.session.async_payment_succeeded / _failed resolves this.
    await repo.updatePaymentAttemptBySessionId(session.id, { status: "processing" });
    return;
  }
  await finalizeVerifiedPayment(stripe, repo, session, bookingOrderId);
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
  schedulingRepo?: SchedulingRepository
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const bookingOrderId = bookingOrderIdFromSession(session);
      if (!bookingOrderId) return;

      if (session.mode === "setup") {
        await handleSetupSessionCompleted(stripe, repo, session, bookingOrderId, schedulingRepo);
      } else if (session.mode === "payment") {
        await handlePaymentSessionCompleted(stripe, repo, session, bookingOrderId);
      }
      return;
    }

    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const bookingOrderId = bookingOrderIdFromSession(session);
      if (!bookingOrderId || session.payment_status !== "paid") return;
      await finalizeVerifiedPayment(stripe, repo, session, bookingOrderId);
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

    default:
      // Explicit no-op — this event type carries no domain action for
      // this milestone. Still marked 'processed' by the caller so it
      // isn't reprocessed on redelivery.
      return;
  }
}
