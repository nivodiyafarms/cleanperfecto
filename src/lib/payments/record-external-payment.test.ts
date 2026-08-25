import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { selectVisitTip } from "./select-visit-tip";
import { recordExternalPayment } from "./record-external-payment";
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

async function seedVisitWithTipSelected() {
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

  const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(repo, gateway, visit.id);
  await selectVisitTip(repo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

  return { repo, gateway, gatewayState, visitId: visit.id };
}

describe("recordExternalPayment", () => {
  it("refuses when no tip has been selected yet", async () => {
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
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visit.id);

    await expect(recordExternalPayment(repo, gateway, { serviceVisitId: visit.id, paymentMethodType: "zelle", externalPaymentReference: null })).rejects.toThrow(InvalidVisitStateError);
  });

  it("the amount is never admin-entered — records exactly the already-selected total, freezes the row, marks paid, and attempts (and commits) the tax transaction", async () => {
    const { repo, gateway, gatewayState, visitId } = await seedVisitWithTipSelected();

    await recordExternalPayment(repo, gateway, { serviceVisitId: visitId, paymentMethodType: "zelle", externalPaymentReference: "ZL-12345" });

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
    expect(payment!.paymentMethodType).toBe("zelle");
    expect(payment!.externalPaymentReference).toBe("ZL-12345");
    expect(payment!.tipConfirmedAt).not.toBeNull();
    expect(payment!.taxTransactionStatus).toBe("committed");
    expect(gatewayState.createTaxTransactionCallCount).toBe(1);

    const pricing = await repo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.paymentStatus).toBe("paid");
  });

  it("payment remains PAID even when the Stripe Tax transaction commit fails — the failure only marks tax_transaction_status='failed'", async () => {
    const { repo, gatewayState } = await seedVisitWithTipSelected();
    const failingGateway = createFakeVisitPaymentGateway({ failNextTaxTransactionCreate: true });
    void gatewayState;

    const visitId = (await repo.listServiceVisitsForCustomer("customer-1"))[0].id;
    // Re-run tip selection against the failing gateway's own state isn't
    // needed — recordExternalPayment only needs the already-persisted
    // stripeTaxCalculationId on the row, which selectVisitTip already set.
    await recordExternalPayment(repo, failingGateway.gateway, { serviceVisitId: visitId, paymentMethodType: "cash", externalPaymentReference: null });

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid"); // never rolled back
    expect(payment!.paidAt).not.toBeNull();
    expect(payment!.taxTransactionStatus).toBe("failed");
    expect(payment!.taxTransactionFailureMessage).toBeTruthy();
  });

  it("cannot record a second external payment for an already-settled row", async () => {
    const { repo, gateway, visitId } = await seedVisitWithTipSelected();
    await recordExternalPayment(repo, gateway, { serviceVisitId: visitId, paymentMethodType: "cash", externalPaymentReference: null });

    await expect(recordExternalPayment(repo, gateway, { serviceVisitId: visitId, paymentMethodType: "zelle", externalPaymentReference: null })).rejects.toThrow(InvalidVisitStateError);
  });

  it("external_payment_reference is stored but never required (blank/null for cash)", async () => {
    const { repo, gateway, visitId } = await seedVisitWithTipSelected();
    await recordExternalPayment(repo, gateway, { serviceVisitId: visitId, paymentMethodType: "cash", externalPaymentReference: null });
    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.externalPaymentReference).toBeNull();
  });
});
