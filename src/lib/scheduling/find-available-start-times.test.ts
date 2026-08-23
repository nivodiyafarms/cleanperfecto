import { describe, expect, it } from "vitest";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { findAvailableStartTimes } from "./find-available-start-times";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

describe("findAvailableStartTimes (orchestrator)", () => {
  it("returns 08:00 as available for a cleaner with a full-day recurring rule and no existing bookings", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
    });
    const result = await findAvailableStartTimes(repo, {
      date: "2026-08-24", // Monday
      serviceMinutes: 120,
      requiredCleanerCount: 1,
      timezone: "America/Chicago",
    });
    expect(result.availableStartTimes).toContain("08:00");
  });

  it("excludes a time slot already confirmed for the only available cleaner", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
    });

    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-24",
      requestedStartTime: "08:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "08:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

    const result = await findAvailableStartTimes(repo, {
      date: "2026-08-24",
      serviceMinutes: 120,
      requiredCleanerCount: 1,
      timezone: "America/Chicago",
    });
    expect(result.availableStartTimes).not.toContain("09:00");
  });

  it("a merely-requested visit (never confirmed) never reduces availability", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
    });
    await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-24",
      requestedStartTime: "08:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    const result = await findAvailableStartTimes(repo, {
      date: "2026-08-24",
      serviceMinutes: 120,
      requiredCleanerCount: 1,
      timezone: "America/Chicago",
    });
    expect(result.availableStartTimes).toContain("08:00");
  });

  it("returns no availability on a business-level closed day", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
      dayOverrides: [{ id: "override-1", overrideDate: "2026-08-24", type: "closed_all_day", blockStartTime: null, blockEndTime: null }],
    });
    const result = await findAvailableStartTimes(repo, {
      date: "2026-08-24",
      serviceMinutes: 120,
      requiredCleanerCount: 1,
      timezone: "America/Chicago",
    });
    expect(result.availableStartTimes).toEqual([]);
    expect(result.closedByOverride).toBe(true);
  });
});
