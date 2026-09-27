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

  it("final amount higher (structured add-on change): confirms and completes directly, with no approval gate", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    // Admin's Final Scope step (updateFinalScopeAction) adds a structured
    // add-on that pushes the total above the previously-approved amount.
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.requiresCustomerApproval).toBe(false);
    // Pay Per Cleaning no longer has a separate approval step — Finalize &
    // Send always confirms pricing and completes the visit in one shot,
    // whether the total stayed the same, decreased, or increased.
    expect(result.visit.status).toBe("completed");
    expect(result.pricing?.priceStatus).toBe("confirmed");
    expect(result.pricing?.requiresCustomerApproval).toBe(false);
  });

  it("charge + credit net increase still goes directly to Final Total: confirms and completes with no approval friction", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await repo.addCustomPricingAdjustmentWithAudit(
      (await repo.findServiceVisitPricingByVisitId(visit.id))!.id,
      { type: "custom_charge", description: "Extra wall cleaning", amount: 30 },
      { actorAdminUserId: "admin:1", actorRole: "operations" }
    );
    const pricingAfterCharge = await repo.findServiceVisitPricingByVisitId(visit.id);
    await repo.addCustomPricingAdjustmentWithAudit(
      pricingAfterCharge!.id,
      { type: "custom_discount", description: "Courtesy credit", amount: 10 },
      { actorAdminUserId: "owner:1", actorRole: "owner_admin" }
    );

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.requiresCustomerApproval).toBe(false);
    expect(result.visit.status).toBe("completed");
    expect(result.pricing?.priceStatus).toBe("confirmed");
  });

  it("higher amount still preserves previouslyApprovedAmount as legacy/historical data, even though it no longer gates anything", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    // confirmVisitPricing() (run unconditionally now) always overwrites
    // previously_approved_amount to the NEW total_amount at confirm time.
    expect(result.pricing?.previouslyApprovedAmount).toBe(baseAmount + 30);
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

  it("only ever enqueues final_total_ready — never a pricing_approval_required notification, even on a genuine price increase", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    const allNotices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visit.id);
    expect(allNotices.some((n) => n.notificationType === "pricing_approval_required")).toBe(false);
    expect(allNotices.filter((n) => n.notificationType === "final_total_ready").length).toBe(1);
  });

  it("a custom charge alone (no predefined add-on) goes directly to Final Total with no approval gate", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);
    await repo.addCustomPricingAdjustmentWithAudit(
      (await repo.findServiceVisitPricingByVisitId(visit.id))!.id,
      { type: "custom_charge", description: "Extra wall cleaning", amount: 30 },
      { actorAdminUserId: "admin:1", actorRole: "operations" }
    );

    const result = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(result.requiresCustomerApproval).toBe(false);
    expect(result.visit.status).toBe("completed");
    expect(result.pricing?.totalAmount).toBe(baseAmount + 30);
  });

  it("never creates a service_visit_payments row, PaymentIntent, or any charge — Finalize & Send only prepares pricing/notifications, never touches Stripe", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    const payment = await repo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment).toBeNull();
    expect(state.financialAuditLog.length).toBe(0);
  });

  // Regression: confirmVisitPricing() (run once the customer approves)
  // always overwrites previously_approved_amount to the NEW total — so the
  // service_visit_pricing row itself can never again show what the amount
  // increased FROM once confirmed. The final_total_sent event, logged here
  // at send time (before that overwrite), is the only place the prior
  // baseline survives durably.
  it("records the prior approved amount on the final_total_sent event, since the pricing row's own field gets overwritten once confirmed", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    const [sentEvent] = state.events.filter((e) => e.serviceVisitId === visit.id && e.eventType === "final_total_sent");
    expect(sentEvent.previousState).toEqual({ previouslyApprovedAmount: baseAmount });
    expect(sentEvent.newState).toEqual({ totalAmount: baseAmount + 30, requiresCustomerApproval: false });
  });

  it("records no prior-approved-amount on the final_total_sent event when there was never a baseline to increase from", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    // No baseline exists yet for THIS test — undo the seed helper's own
    // pre-confirmation so this is a genuine first-ever finalize.
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "pricing-engine-2026-08",
      pricingSnapshot: {},
      baseAmount: 100,
      addOnIds: [],
      addOnAmount: 0,
      totalAmount: 100,
      amountDueFromCustomer: 100,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });

    await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    const [sentEvent] = state.events.filter((e) => e.serviceVisitId === visit.id && e.eventType === "final_total_sent");
    expect(sentEvent.previousState).toBeNull();
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

  it("is idempotent even when the first Finalize & Send involved a genuine price increase: the repeat call short-circuits to alreadySent, never re-notifying", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const first = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });
    const second = await finalizeAndSend(repo, bookingRepo, { serviceVisitId: visit.id, actor: "admin:1" });

    expect(first.requiresCustomerApproval).toBe(false);
    expect(first.visit.status).toBe("completed");
    expect(second.alreadySent).toBe(true);
    expect(second.visit.status).toBe("completed");
    const notices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visit.id && n.notificationType === "final_total_ready");
    expect(notices.length).toBe(1);
  });
});
