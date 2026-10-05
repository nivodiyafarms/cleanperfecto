import { randomUUID } from "node:crypto";
import type { CustomerDefaultPaymentMethodPatch, CustomerStripeInfo, BookingRepository } from "../repository";
import type {
  BookingOrderRow,
  BookingOrderStatus,
  NewBookingOrderRow,
  NewPaymentAttemptRow,
  NewPrepaidPackageRow,
  PaymentAttemptRow,
  PaymentAttemptStatusPatch,
  QuoteRequestForBookingRow,
  WebhookClaim,
  WebhookProcessingStatus,
} from "../types";

interface FakeWebhookEventRow {
  id: string;
  stripeEventId: string;
  eventType: string;
  processingStatus: WebhookProcessingStatus;
  /** Mirrors stripe_webhook_events.processing_claimed_at — tests simulate a crashed/stuck worker by backdating this past PROCESSING_LEASE_MS, directly via the exposed `state.webhookEventsByStripeId` map. */
  processingClaimedAt: Date | null;
  /** The token the real claim_stripe_webhook_event() would return — compared by markWebhookEventProcessed/Failed so a stale worker superseded by a later reclaim can't clobber the reclaimer's outcome. A monotonic counter, not wall-clock time, so two claims within the same test tick are still distinguishable. */
  claimToken: string | null;
  /** Captured on first claim, same as the real ledger's payload column — what retryStuckWebhookEvents replays from, independent of Stripe ever redelivering. */
  payload: unknown;
}

const PROCESSING_LEASE_MS = 5 * 60_000;

/**
 * In-memory BookingRepository that mirrors the real Postgres semantics
 * this milestone depends on (client_request_id/booking_order_id/
 * stripe_checkout_session_id/stripe_event_id uniqueness, the webhook
 * received/processing/processed/failed state machine, conditional status
 * transitions) closely enough to exercise the actual idempotency/trust
 * properties in unit tests without a real database. Exposes its internal
 * state for test assertions via the returned `state` object.
 */
export function createFakeBookingRepository(
  seed: {
    quotes?: Record<string, QuoteRequestForBookingRow>;
    customers?: Record<string, CustomerStripeInfo>;
    completedVisitEmails?: Set<string>;
  } = {}
) {
  const quotes = seed.quotes ?? {};
  const customers = new Map<string, CustomerStripeInfo>(Object.entries(seed.customers ?? {}));
  const completedVisitEmails = seed.completedVisitEmails ?? new Set<string>();

  let claimTokenCounter = 0;

  const bookingOrdersById = new Map<string, BookingOrderRow>();
  const bookingOrdersByClientRequestId = new Map<string, string>();

  const paymentAttemptsById = new Map<string, PaymentAttemptRow>();
  const paymentAttemptsBySessionId = new Map<string, string>();

  const prepaidPackagesByBookingOrderId = new Map<string, NewPrepaidPackageRow & { id: string }>();

  const webhookEventsByStripeId = new Map<string, FakeWebhookEventRow>();

  const repo: BookingRepository = {
    async hasCompletedVisitByEmail(emailNormalized: string) {
      return completedVisitEmails.has(emailNormalized);
    },
    async hasCompletedVisitByPhone() {
      return false;
    },
    async hasCompletedVisitByAddress() {
      return false;
    },

    async findQuoteRequestById(id: string) {
      return quotes[id] ?? null;
    },

    async getCustomerForStripe(customerId: string) {
      return customers.get(customerId) ?? null;
    },
    async setCustomerStripeId(customerId: string, stripeCustomerId: string) {
      const existing = customers.get(customerId);
      if (existing) customers.set(customerId, { ...existing, stripeCustomerId });
    },
    async setCustomerDefaultPaymentMethod(customerId: string, patch: CustomerDefaultPaymentMethodPatch) {
      const existing = customers.get(customerId);
      if (existing) {
        customers.set(customerId, {
          ...existing,
          stripeDefaultPaymentMethodId: patch.stripePaymentMethodId,
          stripePaymentMethodBrand: patch.brand,
          stripePaymentMethodLast4: patch.last4,
        });
      }
    },

    async insertBookingOrder(row: NewBookingOrderRow): Promise<BookingOrderRow> {
      const existingId = bookingOrdersByClientRequestId.get(row.clientRequestId);
      if (existingId) {
        return bookingOrdersById.get(existingId) as BookingOrderRow;
      }

      const id = randomUUID();
      const created: BookingOrderRow = {
        id,
        status: "draft",
        paymentAuthorizationTextSnapshot: null,
        consentVersionId: null,
        cancellationPolicyTextSnapshot: null,
        ...row,
      };
      bookingOrdersById.set(id, created);
      bookingOrdersByClientRequestId.set(row.clientRequestId, id);
      return created;
    },

    async findBookingOrderById(id: string) {
      return bookingOrdersById.get(id) ?? null;
    },

    async updateBookingOrderStatus(id: string, expectedStatus: BookingOrderStatus, nextStatus: BookingOrderStatus) {
      const existing = bookingOrdersById.get(id);
      if (!existing || existing.status !== expectedStatus) return false;
      bookingOrdersById.set(id, { ...existing, status: nextStatus });
      return true;
    },

    async findActivePaymentAttempt(bookingOrderId: string) {
      for (const attempt of paymentAttemptsById.values()) {
        if (attempt.bookingOrderId === bookingOrderId && (attempt.status === "created" || attempt.status === "processing")) {
          return attempt;
        }
      }
      return null;
    },

    async findCompletedPaymentAttemptForBookingOrder(bookingOrderId: string) {
      for (const attempt of paymentAttemptsById.values()) {
        if (attempt.bookingOrderId === bookingOrderId && attempt.status === "completed") {
          return attempt;
        }
      }
      return null;
    },

    async insertPaymentAttempt(row: NewPaymentAttemptRow): Promise<PaymentAttemptRow> {
      const id = randomUUID();
      const created: PaymentAttemptRow = {
        id,
        bookingOrderId: row.bookingOrderId,
        mode: row.mode,
        stripeCheckoutSessionId: row.stripeCheckoutSessionId,
        stripeCustomerId: row.stripeCustomerId,
        stripeSetupIntentId: null,
        stripePaymentIntentId: null,
        amount: row.amount,
        currency: "usd",
        status: "created",
        paymentMethodType: row.paymentMethodType,
        packageSubtotalBeforeAchIncentive: row.packageSubtotalBeforeAchIncentive,
        achSavingsAmount: row.achSavingsAmount,
      };
      paymentAttemptsById.set(id, created);
      paymentAttemptsBySessionId.set(row.stripeCheckoutSessionId, id);
      return created;
    },

    async findPaymentAttemptBySessionId(sessionId: string) {
      const id = paymentAttemptsBySessionId.get(sessionId);
      return id ? (paymentAttemptsById.get(id) ?? null) : null;
    },

    async updatePaymentAttemptBySessionId(sessionId: string, patch: PaymentAttemptStatusPatch) {
      const id = paymentAttemptsBySessionId.get(sessionId);
      if (!id) return;
      const existing = paymentAttemptsById.get(id);
      if (!existing) return;
      paymentAttemptsById.set(id, {
        ...existing,
        status: patch.status,
        stripeSetupIntentId: patch.stripeSetupIntentId ?? existing.stripeSetupIntentId,
        stripePaymentIntentId: patch.stripePaymentIntentId ?? existing.stripePaymentIntentId,
      });
    },

    async activatePrepaidPackage(row: NewPrepaidPackageRow) {
      if (prepaidPackagesByBookingOrderId.has(row.bookingOrderId)) {
        return { inserted: false };
      }
      prepaidPackagesByBookingOrderId.set(row.bookingOrderId, { ...row, id: randomUUID() });
      return { inserted: true };
    },

    async claimWebhookEvent(stripeEventId: string, eventType: string, payload: unknown): Promise<WebhookClaim> {
      let existing = webhookEventsByStripeId.get(stripeEventId);
      if (!existing) {
        existing = { id: randomUUID(), stripeEventId, eventType, processingStatus: "received", processingClaimedAt: null, claimToken: null, payload };
        webhookEventsByStripeId.set(stripeEventId, existing);
      }

      // Mirrors claim_stripe_webhook_event()'s single conditional claim: a
      // 'processed' row is a permanent no-op; a 'processing' row is a safe
      // skip UNLESS its lease has expired (simulating a crashed/stuck
      // worker), in which case it can be reclaimed with a fresh token —
      // never permanently stranding the event.
      const leaseExpired =
        existing.processingClaimedAt !== null && Date.now() - existing.processingClaimedAt.getTime() >= PROCESSING_LEASE_MS;
      const claimable =
        existing.processingStatus === "received" || existing.processingStatus === "failed" || (existing.processingStatus === "processing" && leaseExpired);

      if (!claimable) {
        return { shouldProcess: false, eventRowId: existing.id, claimToken: existing.claimToken ?? "" };
      }

      claimTokenCounter += 1;
      const claimToken = `claim-${claimTokenCounter}`;
      existing.processingStatus = "processing";
      existing.processingClaimedAt = new Date();
      existing.claimToken = claimToken;
      return { shouldProcess: true, eventRowId: existing.id, claimToken };
    },

    async markWebhookEventProcessed(eventRowId: string, claimToken: string) {
      for (const row of webhookEventsByStripeId.values()) {
        // A stale/superseded claimToken (a worker outliving its lease,
        // after someone else already reclaimed the row) must not clobber
        // the reclaimer's outcome — same conditional-update guarantee the
        // real markWebhookEventProcessed provides via processing_claimed_at.
        if (row.id === eventRowId && row.claimToken === claimToken) row.processingStatus = "processed";
      }
    },
    async markWebhookEventFailed(eventRowId: string, reason: string, claimToken: string) {
      void reason;
      for (const row of webhookEventsByStripeId.values()) {
        if (row.id === eventRowId && row.claimToken === claimToken) row.processingStatus = "failed";
      }
    },

    async listStuckWebhookEvents(now: Date, leaseSeconds: number, limit: number) {
      const leaseMs = leaseSeconds * 1000;
      return [...webhookEventsByStripeId.values()]
        .filter(
          (row) =>
            row.processingStatus === "failed" ||
            (row.processingStatus === "processing" && row.processingClaimedAt !== null && now.getTime() - row.processingClaimedAt.getTime() >= leaseMs)
        )
        .slice(0, limit)
        .map((row) => ({ stripeEventId: row.stripeEventId, eventType: row.eventType, payload: row.payload }));
    },
  };

  return {
    repo,
    state: {
      bookingOrdersById,
      paymentAttemptsById,
      prepaidPackagesByBookingOrderId,
      webhookEventsByStripeId,
    },
  };
}
