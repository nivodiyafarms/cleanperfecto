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

async function seedReadyVisitWithCustomAdjustments(params: { baseAmount: number; customChargeAmount?: number; customDiscountAmount?: number }) {
  const { baseAmount, customChargeAmount = 0, customDiscountAmount = 0 } = params;
  const amountDueFromCustomer = Math.max(0, baseAmount + customChargeAmount - customDiscountAmount);
  const { repo, state } = createFakeSchedulingRepository();
  const visit = await repo.insertServiceVisit(NEW_VISIT);
  await repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount,
    addOnIds: [],
    addOnAmount: 0,
    customChargeAmount,
    customDiscountAmount,
    totalAmount: amountDueFromCustomer,
    amountDueFromCustomer,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await repo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });
  return { repo, visitId: visit.id, amountDueFromCustomer };
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

  it("a custom discount/credit alone does not reduce the suggested percentage tip — it is a CleanPerfecto concession, not less work performed", async () => {
    const { repo, visitId, amountDueFromCustomer } = await seedReadyVisitWithCustomAdjustments({ baseAmount: 150, customDiscountAmount: 25 });
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);

    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_20" });

    expect(amountDueFromCustomer).toBe(125); // the customer/tax subtotal DOES reflect the discount
    expect(result.tipAmount).toBeCloseTo(150 * 0.2, 2); // the tip suggestion does NOT — based on the undiscounted $150 base
  });

  it("a custom charge increases the suggested percentage tip — it represents real extra chargeable work", async () => {
    const { repo, visitId } = await seedReadyVisitWithCustomAdjustments({ baseAmount: 150, customChargeAmount: 30 });
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);

    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_20" });

    expect(result.tipAmount).toBeCloseTo((150 + 30) * 0.2, 2);
  });

  it("charge + discount together: the tip basis includes the charge but ignores the discount, while the taxable subtotal nets both", async () => {
    const { repo, visitId, amountDueFromCustomer } = await seedReadyVisitWithCustomAdjustments({
      baseAmount: 150,
      customChargeAmount: 30,
      customDiscountAmount: 25,
    });
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    await prepareVisitPaymentReview(repo, gateway, visitId);

    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_20" });

    expect(amountDueFromCustomer).toBe(155); // $150 + $30 - $25 — the worked-example taxable subtotal
    expect(result.tipAmount).toBeCloseTo(180 * 0.2, 2); // tip basis is $150 + $30 = $180, discount excluded

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    const calculation = gatewayState.calculations.get(payment!.stripeTaxCalculationId!);
    expect(calculation!.serviceAmountCents).toBe(15500); // Stripe Tax still calculates against the discounted $155 subtotal
  });

  it("a manually entered custom tip amount is unaffected by a custom discount/credit — the customer's typed dollar amount is used as-is", async () => {
    const { repo, visitId } = await seedReadyVisitWithCustomAdjustments({ baseAmount: 150, customDiscountAmount: 25 });
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);

    const result = await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "custom", customAmount: 40 });

    expect(result.tipAmount).toBe(40);
  });
});
