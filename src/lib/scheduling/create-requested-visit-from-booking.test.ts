import { describe, expect, it } from "vitest";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

function baseInput(overrides: Partial<Parameters<typeof createRequestedVisitFromBooking>[1]> = {}) {
  return {
    bookingOrderId: "booking-1",
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    cleaningType: "standard" as const,
    frequency: "one_time" as const,
    requestedDate: "2026-08-24",
    requestedStartTime: "10:00",
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75034|123mainst|",
    ...overrides,
  };
}

describe("createRequestedVisitFromBooking", () => {
  it("creates a 'requested' visit carrying the booking's requested date/time", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, baseInput());
    const visit = state.serviceVisitsById.get(visitId);
    expect(visit?.status).toBe("requested");
    expect(visit?.bookingOrderId).toBe("booking-1");
    expect(visit?.recurringScheduleId).toBeNull();
  });

  it("logs a 'requested' event", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await createRequestedVisitFromBooking(repo, baseInput());
    expect(state.events.some((e) => e.eventType === "requested")).toBe(true);
  });

  it("does not create a recurring_schedules row for a one-time booking", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await createRequestedVisitFromBooking(repo, baseInput({ frequency: "one_time" }));
    expect(state.recurringSchedulesById.size).toBe(0);
  });

  it("auto-creates a recurring_schedules row for a recurring booking, derived from the requested date/time", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { recurringScheduleId } = await createRequestedVisitFromBooking(
      repo,
      baseInput({ frequency: "weekly", requestedDate: "2026-08-24" /* Monday */, requestedStartTime: "09:00" })
    );
    expect(recurringScheduleId).not.toBeNull();
    const schedule = state.recurringSchedulesById.get(recurringScheduleId as string);
    expect(schedule?.cadence).toBe("weekly");
    expect(schedule?.preferredDayOfWeek).toBe(1); // Monday
    expect(schedule?.preferredStartTime).toBe("09:00");
  });

  it("is idempotent — a second call for the same booking order returns the existing visit rather than creating a duplicate", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const first = await createRequestedVisitFromBooking(repo, baseInput());
    const second = await createRequestedVisitFromBooking(repo, baseInput());
    expect(second.visitId).toBe(first.visitId);
    expect(state.serviceVisitsById.size).toBe(1);
  });
});
