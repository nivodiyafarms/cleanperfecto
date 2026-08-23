import { describe, expect, it } from "vitest";
import { bootstrapRecurringVisitPlansFromDirectVisit } from "./bootstrap-recurring-visit-plans-from-direct-visit";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

async function seedScheduleAndDirectVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
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
  const directVisit = await repo.insertServiceVisit({
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    bookingOrderId: "booking-1",
    prepaidPackageId: null,
    recurringScheduleId: null,
    visitNumber: null,
    cleaningType: "standard",
    frequency: "weekly",
    requestedStartAt: new Date("2026-08-24T15:00:00Z"),
    timezone: "America/Chicago",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  return { schedule, directVisit };
}

describe("bootstrapRecurringVisitPlansFromDirectVisit", () => {
  it("creates exactly six universal plans, slot #1 already linked to the direct visit", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule, directVisit } = await seedScheduleAndDirectVisit(repo);

    const plans = await bootstrapRecurringVisitPlansFromDirectVisit(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
      directServiceVisitId: directVisit.id,
    });

    expect(plans.length).toBe(6);
    expect(plans[0].status).toBe("linked");
    expect(plans[0].serviceVisitId).toBe(directVisit.id);
    expect(plans.slice(1).every((p) => p.status === "planned")).toBe(true);
  });

  it("spaces slots #2-6 one cadence interval apart, starting after slot #1", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule, directVisit } = await seedScheduleAndDirectVisit(repo);

    const plans = await bootstrapRecurringVisitPlansFromDirectVisit(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
      directServiceVisitId: directVisit.id,
    });

    expect(plans.map((p) => p.plannedDate)).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });

  it("creates no additional service_visits — only the one already-existing direct visit is ever referenced", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { schedule, directVisit } = await seedScheduleAndDirectVisit(repo);
    await bootstrapRecurringVisitPlansFromDirectVisit(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
      directServiceVisitId: directVisit.id,
    });
    expect(state.serviceVisitsById.size).toBe(1);
  });

  it("is idempotent — calling twice does not create a second batch", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { schedule, directVisit } = await seedScheduleAndDirectVisit(repo);
    const input = {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly" as const,
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
      directServiceVisitId: directVisit.id,
    };
    await bootstrapRecurringVisitPlansFromDirectVisit(repo, input);
    await bootstrapRecurringVisitPlansFromDirectVisit(repo, input);
    expect(state.recurringVisitPlansById.size).toBe(6);
  });
});
