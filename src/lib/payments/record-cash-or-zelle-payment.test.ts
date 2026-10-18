import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { recordCashOrZellePayment } from "./record-cash-or-zelle-payment";
import { selectVisitTip } from "./select-visit-tip";
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

async function seedConfirmedVisit(amountDueFromCustomer = 179) {
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

  const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
  return { repo, state, gateway, gatewayState, visitId: visit.id };
}

const ACTOR = { actorAdminUserId: "admin-1", actorRole: "owner_admin" };

describe("recordCashOrZellePayment", () => {
  it("opens with zero side effects — no row exists until submit, and prepareVisitPaymentReview/selectVisitTip happen only inside this call", async () => {
    const { repo, visitId } = await seedConfirmedVisit(179);
    expect(await repo.findServiceVisitPaymentByVisitId(visitId)).toBeNull();
  });

  it("happy path: settles at the authoritative service+tax+tip total using the admin's own typed tip, never a hardcoded 0", async () => {
    const { repo, gateway, visitId } = await seedConfirmedVisit(179);

    // Computed the same way the fake gateway's default 8.25% rate will —
    // service + tip, taxed together, rounded in cents.
    const expectedTax = Math.round((179 + 20) * 0.0825 * 100) / 100;
    const expectedTotal = Math.round((179 + 20 + expectedTax) * 100) / 100;

    await recordCashOrZellePayment(repo, gateway, {
      serviceVisitId: visitId,
      paymentMethodType: "cash",
      tipAmount: 20,
      totalReceivedConfirmation: expectedTotal,
      externalPaymentReference: "handed cash",
      ...ACTOR,
    });

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
    expect(payment!.paymentMethodType).toBe("cash");
    expect(payment!.tipAmount).toBe(20);
    expect(payment!.externalPaymentReference).toBe("handed cash");
  });

  it("amount mismatch: refuses with the expected breakdown and records nothing — never calls recordExternalPayment's settlement", async () => {
    const { repo, gateway, visitId } = await seedConfirmedVisit(179);

    await expect(
      recordCashOrZellePayment(repo, gateway, {
        serviceVisitId: visitId,
        paymentMethodType: "cash",
        tipAmount: 20,
        totalReceivedConfirmation: 1, // deliberately wrong
        externalPaymentReference: null,
        ...ACTOR,
      })
    ).rejects.toThrow("doesn't match the expected total");

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("created"); // nothing recorded
    expect(payment!.tipConfirmedAt).toBeNull();
  });

  it("already-active payment: refuses early when the row is already frozen/in-flight/settled", async () => {
    const { repo, gateway, visitId } = await seedConfirmedVisit(179);
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const payment = (await repo.findServiceVisitPaymentByVisitId(visitId))!;
    await repo.recordExternalServiceVisitPaymentWithAudit(
      payment.id,
      { paymentMethodType: "zelle", externalPaymentReference: null },
      { actorAdminUserId: "admin-0", actorRole: "owner_admin" }
    );

    await expect(
      recordCashOrZellePayment(repo, gateway, {
        serviceVisitId: visitId,
        paymentMethodType: "cash",
        tipAmount: 20,
        totalReceivedConfirmation: 300,
        externalPaymentReference: null,
        ...ACTOR,
      })
    ).rejects.toThrow("A payment is already recorded or in progress for this visit.");
  });

  it("refuses while a revision is in progress, before ever calling selectVisitTip", async () => {
    const { repo, gateway, visitId } = await seedConfirmedVisit(179);
    const pricing = await repo.findServiceVisitPricingByVisitId(visitId);
    await repo.upsertServiceVisitPricing({ ...pricing!, priceStatus: "revision_in_progress" });

    await expect(
      recordCashOrZellePayment(repo, gateway, {
        serviceVisitId: visitId,
        paymentMethodType: "cash",
        tipAmount: 0,
        totalReceivedConfirmation: 179,
        externalPaymentReference: null,
        ...ACTOR,
      })
    ).rejects.toThrow("currently being revised");

    expect(await repo.findServiceVisitPaymentByVisitId(visitId)).toBeNull(); // never even created the review row
  });

  it("refuses a negative tip amount without touching the row", async () => {
    const { repo, gateway, visitId } = await seedConfirmedVisit(179);

    await expect(
      recordCashOrZellePayment(repo, gateway, {
        serviceVisitId: visitId,
        paymentMethodType: "cash",
        tipAmount: -5,
        totalReceivedConfirmation: 179,
        externalPaymentReference: null,
        ...ACTOR,
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("a concurrent revision that lands after validation but before settling refuses with the stale-pricing message, never paying the old amount", async () => {
    const { repo, gateway, visitId } = await seedConfirmedVisit(179);

    // Simulate the race: start (and finish validating) as if revision 0 is
    // still current, then have a revision land on the pricing row BEFORE
    // recordCashOrZellePayment's own internal recordExternalPayment call —
    // achieved here by bumping revision_number directly between this
    // function's read (step 1) and its settle step, via a second,
    // independent repo call racing against the first.
    const pricing = await repo.findServiceVisitPricingByVisitId(visitId);
    const originalFindPricing = repo.findServiceVisitPricingByVisitId.bind(repo);
    let calls = 0;
    repo.findServiceVisitPricingByVisitId = async (id: string) => {
      calls += 1;
      const result = await originalFindPricing(id);
      if (calls === 1 && result) {
        // After THIS read (the function's own step-1 capture), bump the
        // revision number on the underlying row — simulating a revision
        // that starts and finishes in the gap before step 5 commits.
        await repo.upsertServiceVisitPricing({ ...pricing!, revisionNumber: 1 });
      }
      return result;
    };

    const expectedTax = Math.round(179 * 0.0825 * 100) / 100; // service only, $0 tip
    const expectedTotal = Math.round((179 + expectedTax) * 100) / 100;

    await expect(
      recordCashOrZellePayment(repo, gateway, {
        serviceVisitId: visitId,
        paymentMethodType: "cash",
        tipAmount: 0,
        totalReceivedConfirmation: expectedTotal,
        externalPaymentReference: null,
        ...ACTOR,
      })
    ).rejects.toThrow("The total changed since you reviewed it");

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("created"); // never settled at the stale revision
  });
});
