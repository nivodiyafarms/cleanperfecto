import { describe, expect, it } from "vitest";
import { changeRecurringSchedule } from "./change-recurring-schedule";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

describe("changeRecurringSchedule", () => {
  it("creates a new version and supersedes the old one, preserving history", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { recurringScheduleId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "weekly",
      requestedDate: "2026-08-24", // Monday
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    const newSchedule = await changeRecurringSchedule(repo, {
      currentScheduleId: recurringScheduleId as string,
      newCadence: "weekly",
      newPreferredDayOfWeek: 4, // Thursday
      newPreferredStartTime: "13:00",
      effectiveFrom: "2026-09-10",
    });

    const old = state.recurringSchedulesById.get(recurringScheduleId as string);
    expect(old?.status).toBe("superseded");
    expect(old?.effectiveUntil).toBe("2026-09-10");
    expect(newSchedule.supersedesId).toBe(recurringScheduleId);
    expect(newSchedule.preferredDayOfWeek).toBe(4);
    expect(newSchedule.preferredStartTime).toBe("13:00");
    expect(newSchedule.status).toBe("active");
  });

  it("preserves the OLD row's cadence/day/time unchanged rather than mutating it in place", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { recurringScheduleId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "weekly",
      requestedDate: "2026-08-24",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    await changeRecurringSchedule(repo, {
      currentScheduleId: recurringScheduleId as string,
      newCadence: "biweekly",
      newPreferredDayOfWeek: 4,
      newPreferredStartTime: "13:00",
      effectiveFrom: "2026-09-10",
    });

    const old = state.recurringSchedulesById.get(recurringScheduleId as string);
    expect(old?.cadence).toBe("weekly");
    expect(old?.preferredDayOfWeek).toBe(1);
    expect(old?.preferredStartTime).toBe("10:00");
  });
});
