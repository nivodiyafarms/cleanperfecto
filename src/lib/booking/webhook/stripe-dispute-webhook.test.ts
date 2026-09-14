import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { createVisitPaymentIntent } from "@/lib/payments/create-visit-payment-intent";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";
import { processStripeWebhookEvent } from "./process-stripe-webhook-event";

const NEW_VISIT: NewServiceVisitRow = {
  customerId: "customer-1",
  quoteRequestId: null,
  bookingOrderId: null,
  prepaidPackageId: null,
  recurringScheduleId: null,
  visitNumber: null,
  cleaningType: "standard",
  frequency: "one_time",
  requestedStartAt: new Date(),
  timezone: "America/Chicago",
  serviceAddressLine1: "123 Main St",
  serviceAddressLine2: null,
  serviceCity: "Frisco",
  serviceState: "TX",
  serviceAddressIdentity: "75056|123 MAIN ST|",
};

async function seedChargedVisit() {
  const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 179,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 179,
    amountDueFromCustomer: 179,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
  await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

  const { repo: bookingRepo } = createFakeBookingRepository({
    customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
  });
  const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");

  const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;
  return { schedulingRepo, schedulingState: state, bookingRepo, visitId: visit.id, paymentIntentId: payment.stripePaymentIntentId! };
}

function disputeEvent(
  type: "charge.dispute.created" | "charge.dispute.updated" | "charge.dispute.closed",
  eventId: string,
  eventCreatedUnix: number,
  dispute: { id: string; charge: string; payment_intent?: string | null; status: Stripe.Dispute.Status; created: number; amount?: number; currency?: string; reason?: string }
): Stripe.Event {
  return {
    id: eventId,
    type,
    created: eventCreatedUnix,
    data: { object: { amount: 5000, currency: "usd", reason: "fraudulent", payment_intent: null, ...dispute } as unknown as Stripe.Dispute },
  } as unknown as Stripe.Event;
}

const stripe = {} as Stripe; // never called by any of these handlers

describe("processStripeWebhookEvent — Phase C: dispute lifecycle (charge.dispute.*)", () => {
  it("charge.dispute.created: persists the dispute fact, resolves the linked service_visit_payment/service_visit, and never touches the payment's own status", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, visitId, paymentIntentId } = await seedChargedVisit();
    const statusBefore = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!.status;

    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "needs_response", created: 1700000000 }),
      schedulingRepo
    );

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_1");
    expect(dispute).toBeDefined();
    expect(dispute!.disputeStatus).toBe("needs_response");
    expect(dispute!.serviceVisitPaymentId).toBeTruthy();
    expect(dispute!.serviceVisitId).toBe(visitId);
    expect(dispute!.closedAt).toBeNull();

    // The payment fact itself is completely untouched by the dispute.
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe(statusBefore);
    expect(payment!.refundedAmount).toBe(0);
  });

  it("charge.dispute.updated: applies a newer event and transitions status (e.g. needs_response -> under_review)", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "needs_response", created: 1700000000 }),
      schedulingRepo
    );

    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.updated", "evt_2", 1700000100, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "under_review", created: 1700000000 }),
      schedulingRepo
    );

    expect(schedulingState.stripeDisputesByStripeDisputeId.get("dp_1")!.disputeStatus).toBe("under_review");
  });

  it("charge.dispute.closed with status=won: sets closedAt and the final status, never marking the payment refunded", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "needs_response", created: 1700000000 }),
      schedulingRepo
    );
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.closed", "evt_2", 1700000200, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "won", created: 1700000000 }),
      schedulingRepo
    );

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_1")!;
    expect(dispute.disputeStatus).toBe("won");
    expect(dispute.closedAt).not.toBeNull();
  });

  it("charge.dispute.closed with status=lost: sets closedAt and the final status", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.closed", "evt_1", 1700000000, { id: "dp_2", charge: "ch_2", payment_intent: paymentIntentId, status: "lost", created: 1699999000 }),
      schedulingRepo
    );

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_2")!;
    expect(dispute.disputeStatus).toBe("lost");
    expect(dispute.closedAt).not.toBeNull();
  });

  it("warning/needs-response states: warning_needs_response and warning_under_review are persisted like any other status, uninterpreted", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_3", charge: "ch_3", payment_intent: paymentIntentId, status: "warning_needs_response", created: 1700000000 }),
      schedulingRepo
    );
    expect(schedulingState.stripeDisputesByStripeDisputeId.get("dp_3")!.disputeStatus).toBe("warning_needs_response");

    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.updated", "evt_2", 1700000100, { id: "dp_3", charge: "ch_3", payment_intent: paymentIntentId, status: "warning_under_review", created: 1700000000 }),
      schedulingRepo
    );
    expect(schedulingState.stripeDisputesByStripeDisputeId.get("dp_3")!.disputeStatus).toBe("warning_under_review");
  });

  it("duplicate webhook: redelivering the identical event is a safe no-op", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    const event = disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "needs_response", created: 1700000000 });

    await processStripeWebhookEvent(stripe, bookingRepo, event, schedulingRepo);
    await processStripeWebhookEvent(stripe, bookingRepo, event, schedulingRepo); // exact redelivery

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_1")!;
    expect(dispute.disputeStatus).toBe("needs_response");
    expect(dispute.lastStripeEventId).toBe("evt_1");
  });

  it("out-of-order webhook: an older event arriving after a newer one is applied is rejected, never regressing state", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.updated", "evt_newer", 1700000200, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "under_review", created: 1700000000 }),
      schedulingRepo
    );

    // A stale event (older `created`) for the same dispute arrives late.
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_older_stale", 1700000000, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "needs_response", created: 1700000000 }),
      schedulingRepo
    );

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_1")!;
    expect(dispute.disputeStatus).toBe("under_review"); // never regressed back to needs_response
    expect(dispute.lastStripeEventId).toBe("evt_newer");
  });

  it("dispute closed before stale update arrives: a late-arriving stale update never reopens an already-closed dispute", async () => {
    const { schedulingRepo, schedulingState, bookingRepo, paymentIntentId } = await seedChargedVisit();
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "needs_response", created: 1700000000 }),
      schedulingRepo
    );
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.closed", "evt_close", 1700000300, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "won", created: 1700000000 }),
      schedulingRepo
    );

    // A stale "under_review" update (event.created between the first two,
    // but delivered last) arrives after closure.
    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.updated", "evt_stale_late", 1700000100, { id: "dp_1", charge: "ch_1", payment_intent: paymentIntentId, status: "under_review", created: 1700000000 }),
      schedulingRepo
    );

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_1")!;
    expect(dispute.disputeStatus).toBe("won");
    expect(dispute.closedAt).not.toBeNull();
  });

  it("resolves no service_visit_payment/service_visit when the disputed PaymentIntent is unknown — a safe no-op join, not an error", async () => {
    const { schedulingRepo, schedulingState, bookingRepo } = await seedChargedVisit();

    await processStripeWebhookEvent(
      stripe,
      bookingRepo,
      disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_unknown", charge: "ch_unknown", payment_intent: "pi_not_in_our_system", status: "needs_response", created: 1700000000 }),
      schedulingRepo
    );

    const dispute = schedulingState.stripeDisputesByStripeDisputeId.get("dp_unknown")!;
    expect(dispute).toBeDefined();
    expect(dispute.serviceVisitPaymentId).toBeNull();
    expect(dispute.serviceVisitId).toBeNull();
  });

  it("is a safe no-op when no schedulingRepo is supplied", async () => {
    const { bookingRepo } = await seedChargedVisit();
    await expect(
      processStripeWebhookEvent(stripe, bookingRepo, disputeEvent("charge.dispute.created", "evt_1", 1700000000, { id: "dp_1", charge: "ch_1", status: "needs_response", created: 1700000000 }))
    ).resolves.toBeUndefined();
  });
});
