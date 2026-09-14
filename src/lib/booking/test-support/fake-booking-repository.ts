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
}

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

  const bookingOrdersById = new Map<string, BookingOrderRow>();
  const bookingOrdersByClientRequestId = new Map<string, string>();

  const paymentAttemptsById = new Map<string, PaymentAttemptRow>();
  const paymentAttemptsBySessionId = new Map<string, string>();

  const prepaidPackagesByBookingOrderId = new Map<string, { id: string }>();

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
      prepaidPackagesByBookingOrderId.set(row.bookingOrderId, { id: randomUUID() });
      return { inserted: true };
    },

    async claimWebhookEvent(stripeEventId: string, eventType: string): Promise<WebhookClaim> {
      const existing = webhookEventsByStripeId.get(stripeEventId);
      if (!existing) {
        const created: FakeWebhookEventRow = { id: randomUUID(), stripeEventId, eventType, processingStatus: "processing" };
        webhookEventsByStripeId.set(stripeEventId, created);
        return { shouldProcess: true, eventRowId: created.id };
      }
      if (existing.processingStatus === "processed") {
        return { shouldProcess: false, eventRowId: existing.id };
      }
      existing.processingStatus = "processing";
      return { shouldProcess: true, eventRowId: existing.id };
    },

    async markWebhookEventProcessed(eventRowId: string) {
      for (const row of webhookEventsByStripeId.values()) {
        if (row.id === eventRowId) row.processingStatus = "processed";
      }
    },
    async markWebhookEventFailed(eventRowId: string) {
      for (const row of webhookEventsByStripeId.values()) {
        if (row.id === eventRowId) row.processingStatus = "failed";
      }
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
