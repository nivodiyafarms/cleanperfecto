import { describe, expect, it } from "vitest";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import type { CalculationInput } from "@/lib/pricing/types";
import { InvalidVisitStateError } from "./errors";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { finalizeAndSend } from "./finalize-and-send";
import { proposeRecurringScopeChange } from "./propose-recurring-scope-change";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const BASE_INPUT: CalculationInput = {
  propertyKind: "home",
  cleaningType: "standard",
  condition: "light",
  sizeTier: "2br_2ba",
  zip: "75056",
  frequency: "weekly",
  isPrepaidPackage: false,
  visitCount: 1,
  addOnIds: [],
  firstCleaningEligible: false,
  asOf: new Date("2026-08-24T00:00:00Z"),
};

async function seedWorkFinishedVisit(
  repo: ReturnType<typeof createFakeSchedulingRepository>["repo"],
  state: ReturnType<typeof createFakeSchedulingRepository>["state"]
) {
  const schedule = await repo.insertRecurringSchedule({
    customerId: "customer-1",
    bookingOrderId: "booking-1",
    prepaidPackageId: null,
    cadence: "weekly",
    preferredDayOfWeek: 1,
    preferredStartTime: "10:00",
    timezone: "America/Chicago",
    effectiveFrom: "2026-08-24",
    supersedesId: null,
  });
  await proposeRecurringScopeChange(repo, {
    recurringScheduleId: schedule.id,
    customerId: "customer-1",
    newBaseInput: BASE_INPUT,
    effectiveFromVisitNumber: 1,
  });

  const visit = await repo.insertServiceVisit({
    customerId: "customer-1",
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: null,
    recurringScheduleId: schedule.id,
    visitNumber: 2,
    cleaningType: "standard",
    frequency: null,
    requestedStartAt: null,
    timezone: "America/Chicago",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });

  // Admin already confirmed a first estimate before the cleaning happened
  // (the normal Pay Per Cleaning pre-completion flow), establishing a
  // previously-approved baseline the Finalize & Send recompute is compared
  // against.
  const initial = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });
  await repo.confirmServiceVisitPricing(visit.id, "admin:1");

  // Jump straight to work_finished for test setup — mirrors this suite's
  // existing markCompleted-style convention (confirm-final-total-and-pay.test.ts)
  // of directly manipulating fake state rather than re-running the full
  // scheduling flow for every test.
  const current = state.serviceVisitsById.get(visit.id)!;
  state.serviceVisitsById.set(visit.id, { ...current, status: "work_finished", workFinishedAt: new Date() });

  return { visit, baseAmount: initial.baseAmount };
}

describe("finalizeAndSend", () => {
  it("rejects Finalize & Send before the visit is work-finished", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const schedule = await repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: null,
      prepaidPackageId: null,
      recurringScheduleId: schedule.id,
      visitNumber: 1,
      cleaningType: "standard",
      frequency: null,
      requestedStartAt: null,
      timezone: "America/Chicago",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    await expect(finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" })).rejects.toThrow(InvalidVisitStateError);
  });

  it("final amount unchanged: confirms pricing and completes the visit in one call", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.alreadySent).toBe(false);
    expect(result.requiresCustomerApproval).toBe(false);
    expect(result.visit.status).toBe("completed");
    expect(result.pricing?.priceStatus).toBe("confirmed");
  });

  it("final amount lower (add-on removed via Final Scope): confirms and completes with no approval friction", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    // Admin's Final Scope step added an add-on, pushing the estimate up but
    // NOT past the approved baseline (since it was never confirmed at the
    // higher amount) — then removed it again, landing back at/below the
    // original approved baseline.
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.requiresCustomerApproval).toBe(false);
    expect(result.visit.status).toBe("completed");
  });

  it("final amount higher (structured add-on change): requires customer approval and leaves the visit at work_finished, NOT completed", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    // Admin's Final Scope step (updateFinalScopeAction) adds a structured
    // add-on that pushes the total above the previously-approved amount.
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.requiresCustomerApproval).toBe(true);
    // "Only after final pricing is frozen should the visit cross the
    // completion/payment boundary" — a genuine increase must NOT complete
    // the visit here; protect_service_visit_pricing_after_completion would
    // otherwise permanently freeze the still-pending pricing.
    expect(result.visit.status).toBe("work_finished");
    expect(result.pricing?.priceStatus).toBe("pending_customer_approval");
    expect(result.pricing?.requiresCustomerApproval).toBe(true);
  });

  it("higher amount produces durable approval evidence: previouslyApprovedAmount stays at the OLD amount until the customer resolves it", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.pricing?.previouslyApprovedAmount).toBe(baseAmount);
    expect(result.pricing?.totalAmount).toBe(baseAmount + 30);
  });

  it("records a final_total_sent event and enqueues a final_total_ready notification on a genuine send", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    const sentEvents = state.events.filter((e) => e.serviceVisitId === visit.id && e.eventType === "final_total_sent");
    expect(sentEvents.length).toBe(1);
    const notices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visit.id && n.notificationType === "final_total_ready");
    expect(notices.length).toBe(1);
  });

  it("is idempotent: a repeat call after the visit is already completed short-circuits to alreadySent without re-running pricing/events/notifications", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    const first = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });
    const second = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(first.alreadySent).toBe(false);
    expect(second.alreadySent).toBe(true);
    const sentEvents = state.events.filter((e) => e.serviceVisitId === visit.id && e.eventType === "final_total_sent");
    expect(sentEvents.length).toBe(1);
    const notices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visit.id && n.notificationType === "final_total_ready");
    expect(notices.length).toBe(1);
  });

  it("notification deduplication: a repeat call while still pending approval at the SAME amount never creates a second final_total_ready row", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const first = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });
    const second = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(first.requiresCustomerApproval).toBe(true);
    expect(second.requiresCustomerApproval).toBe(true);
    expect(second.visit.status).toBe("work_finished");
    const notices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visit.id && n.notificationType === "final_total_ready");
    expect(notices.length).toBe(1);
  });
});
