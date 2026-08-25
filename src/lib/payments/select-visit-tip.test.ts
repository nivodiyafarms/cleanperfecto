import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { selectVisitTip } from "./select-visit-tip";
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

async function seedReadyVisit(amountDueFromCustomer: number) {
  const { repo, state } = createFakeSchedulingRepository();
  const visit = await repo.insertServiceVisit(NEW_VISIT);
  await repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: amountDueFromCustomer,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: amountDueFromCustomer,
    amountDueFromCustomer,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await repo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });
  return { repo, visitId: visit.id };
}

describe("selectVisitTip", () => {
  it("refuses when Review Charges hasn't happened yet (no payment row)", async () => {
    const { repo, visitId } = await seedReadyVisit(179);
    const { gateway } = createFakeVisitPaymentGateway();
    await expect(selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" })).rejects.toThrow(InvalidVisitStateError);
  });

  it("creates a final Tax Calculation with service+tip line items and persists tip/tax/total", async () => {
    const { repo, visitId } = await seedReadyVisit(179);
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ taxRateBps: 800 });
    await prepareVisitPaymentReview(repo, gateway, visitId);

    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_20" });

    expect(result.tipAmount).toBeCloseTo(179 * 0.2, 2);
    expect(result.taxAmount).toBeCloseTo((179 + 179 * 0.2) * 0.08, 2);
    expect(result.totalAmount).toBeCloseTo(179 + 179 * 0.2 + (179 + 179 * 0.2) * 0.08, 2);
    expect(gatewayState.createTaxCalculationCallCount).toBe(2); // 1 preview + 1 final

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.stripeTaxCalculationId).not.toBeNull();
    expect(payment!.tipConfirmedAt).toBeNull(); // still pre-freeze
  });

  it("Custom $0 creates no gratuity line item and taxes only the service amount", async () => {
    const { repo, visitId } = await seedReadyVisit(179);
    const { gateway } = createFakeVisitPaymentGateway({ taxRateBps: 800 });
    await prepareVisitPaymentReview(repo, gateway, visitId);

    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "custom", customAmount: 0 });

    expect(result.tipAmount).toBe(0);
    expect(result.taxAmount).toBeCloseTo(179 * 0.08, 2);
  });

  it("is freely re-callable pre-freeze — changing the tip selection overwrites the prior one", async () => {
    const { repo, visitId } = await seedReadyVisit(179);
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);

    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const second = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_25" });

    expect(second.tipAmount).toBeCloseTo(179 * 0.25, 2);
  });

  it("refuses to change the tip once frozen (tip_confirmed_at set)", async () => {
    const { repo, visitId } = await seedReadyVisit(179);
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    await repo.freezeServiceVisitPaymentForStripeCard(payment!.id, { stripeCustomerId: "cus_1", stripePaymentMethodId: "pm_1", cardBrand: "visa", cardLast4: "4242" });

    await expect(selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_25" })).rejects.toThrow(InvalidVisitStateError);
  });

  it("tip basis excludes tax, an existing tip, and unrelated fees — it is always the raw amount_due_from_customer for Pay Per Cleaning", async () => {
    const { repo, visitId } = await seedReadyVisit(200);
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    expect(result.tipAmount).toBeCloseTo(30, 2); // 15% of 200, not of 200+tax
  });
});
