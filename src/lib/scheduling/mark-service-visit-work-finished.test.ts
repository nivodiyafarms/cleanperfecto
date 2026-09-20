import { describe, expect, it } from "vitest";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { markServiceVisitWorkFinished } from "./mark-service-visit-work-finished";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedScheduledVisit() {
  const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
  const { visitId } = await createRequestedVisitFromBooking(repo, {
    bookingOrderId: "booking-1",
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    cleaningType: "standard",
    frequency: "one_time",
    requestedDate: "2026-09-10",
    requestedStartTime: "10:00",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-09-10", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
  return { repo, state, visitId };
}

describe("markServiceVisitWorkFinished", () => {
  it("transitions a scheduled visit to work_finished and records work_finished_at", async () => {
    const { repo, state, visitId } = await seedScheduledVisit();
    const changed = await markServiceVisitWorkFinished(repo, visitId, "admin:1");

    expect(changed).toBe(true);
    const visit = state.serviceVisitsById.get(visitId);
    expect(visit?.status).toBe("work_finished");
    expect(visit?.workFinishedAt).not.toBeNull();
  });

  it("logs exactly one work_finished event on the genuine transition", async () => {
    const { repo, state, visitId } = await seedScheduledVisit();
    await markServiceVisitWorkFinished(repo, visitId, "admin:1");

    const events = state.events.filter((e) => e.serviceVisitId === visitId && e.eventType === "work_finished");
    expect(events.length).toBe(1);
    expect(events[0].actor).toBe("admin:1");
  });

  it("is idempotent — calling it again on an already work_finished visit is a safe no-op", async () => {
    const { repo, state, visitId } = await seedScheduledVisit();
    await markServiceVisitWorkFinished(repo, visitId, "admin:1");
    const changedAgain = await markServiceVisitWorkFinished(repo, visitId, "admin:1");

    expect(changedAgain).toBe(false);
    const events = state.events.filter((e) => e.serviceVisitId === visitId && e.eventType === "work_finished");
    expect(events.length).toBe(1);
  });

  it("never touches service_visit_pricing — marking work finished is a status transition only, never a price mutation", async () => {
    const { repo, visitId } = await seedScheduledVisit();
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visitId,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount: 150,
      addOnIds: [],
      addOnAmount: 0,
      totalAmount: 150,
      amountDueFromCustomer: 150,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });
    const before = await repo.findServiceVisitPricingByVisitId(visitId);

    await markServiceVisitWorkFinished(repo, visitId, "admin:1");

    const after = await repo.findServiceVisitPricingByVisitId(visitId);
    expect(after).toEqual(before);
  });

  it("does not transition a visit that isn't currently scheduled (e.g. still requested)", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-09-10",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    const changed = await markServiceVisitWorkFinished(repo, visitId, "admin:1");

    expect(changed).toBe(false);
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("requested");
  });
});
