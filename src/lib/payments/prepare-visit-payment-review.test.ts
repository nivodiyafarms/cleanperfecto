import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";

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

describe("prepareVisitPaymentReview", () => {
  it("refuses before the visit has completed", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await expect(prepareVisitPaymentReview(repo, createFakeVisitPaymentGateway().gateway, visit.id)).rejects.toThrow(InvalidVisitStateError);
  });

  it("refuses when pricing is not confirmed", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    state.serviceVisitsById.set(visit.id, { ...visit, status: "completed" });
    await repo.upsertServiceVisitPricing({
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
    await expect(prepareVisitPaymentReview(repo, createFakeVisitPaymentGateway().gateway, visit.id)).rejects.toThrow(InvalidVisitStateError);
  });

  it("creates the payment row idempotently and returns a preview tax calculation that is never persisted as the final calculation id", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await repo.upsertServiceVisitPricing({
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
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });

    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ taxRateBps: 800 });
    const review = await prepareVisitPaymentReview(repo, gateway, visit.id);

    expect(review.approvedAmount).toBe(179);
    expect(review.previewTaxAmount).toBeCloseTo(179 * 0.08, 2);
    expect(review.previewAmountDueBeforeTip).toBeCloseTo(179 * 1.08, 2);
    expect(gatewayState.createTaxCalculationCallCount).toBe(1);

    const payment = await repo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment).not.toBeNull();
    expect(payment!.stripeTaxCalculationId).toBeNull(); // preview never persisted as final

    // Idempotent: a second call reuses the same row, not a duplicate.
    const review2 = await prepareVisitPaymentReview(repo, gateway, visit.id);
    expect(review2.serviceVisitPaymentId).toBe(review.serviceVisitPaymentId);
  });

  it("exposes baseAmount and an empty lineItems list when nothing was added/adjusted", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount: 138.72,
      addOnIds: [],
      addOnAmount: 0,
      totalAmount: 138.72,
      amountDueFromCustomer: 138.72,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });

    const { gateway } = createFakeVisitPaymentGateway();
    const review = await prepareVisitPaymentReview(repo, gateway, visit.id);

    expect(review.baseAmount).toBe(138.72);
    expect(review.approvedAmount).toBe(138.72);
    expect(review.lineItems).toEqual([]);
  });

  it("itemizes predefined add-ons, custom charges (positive), and custom discounts/credits (negative) as separate line items", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount: 138.72,
      addOnIds: ["inside_oven"],
      addOnAmount: 30,
      customAdjustments: [
        {
          id: "adj-1",
          type: "custom_charge",
          description: "Extra wall cleaning",
          amount: 30,
          addedByAdminUserId: "admin:1",
          addedByRole: "operations",
          addedAt: new Date(),
        },
        {
          id: "adj-2",
          type: "custom_discount",
          description: "Courtesy credit",
          amount: 10,
          addedByAdminUserId: "owner:1",
          addedByRole: "owner_admin",
          addedAt: new Date(),
        },
      ],
      customChargeAmount: 30,
      customDiscountAmount: 10,
      totalAmount: 188.72,
      amountDueFromCustomer: 188.72,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });

    const { gateway } = createFakeVisitPaymentGateway();
    const review = await prepareVisitPaymentReview(repo, gateway, visit.id);

    expect(review.baseAmount).toBe(138.72);
    expect(review.approvedAmount).toBe(188.72);
    expect(review.lineItems).toEqual([
      { description: "Oven Interior", amount: 30 },
      { description: "Extra wall cleaning", amount: 30 },
      { description: "Courtesy credit", amount: -10 },
    ]);
  });

  it("skips the Stripe Tax preview call entirely when nothing is collectible (e.g. prepaid, no extras)", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount: 0,
      addOnIds: [],
      addOnAmount: 0,
      totalAmount: 0,
      amountDueFromCustomer: 0,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });

    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    const review = await prepareVisitPaymentReview(repo, gateway, visit.id);

    expect(review.previewTaxAmount).toBe(0);
    expect(gatewayState.createTaxCalculationCallCount).toBe(0);
  });
});
