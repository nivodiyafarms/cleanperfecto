import { describe, expect, it } from "vitest";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { findAvailableCleaners } from "./find-available-cleaners";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function scheduleVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"], date: string, startTime: string, cleanerId: string, bookingOrderId = "booking-1") {
  const { visitId } = await createRequestedVisitFromBooking(repo, {
    bookingOrderId,
    customerId: "customer-1",
    quoteRequestId: `quote-${bookingOrderId}`,
    cleaningType: "standard",
    frequency: "one_time",
    requestedDate: date,
    requestedStartTime: startTime,
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  await confirmServiceVisit(repo, { serviceVisitId: visitId, date, startTime, cleanerIds: [cleanerId], durationInput: DURATION_INPUT });
  return visitId;
}

describe("findAvailableCleaners — excludeServiceVisitId (reschedule self-conflict)", () => {
  it("BUG: without excludeServiceVisitId, a cleaner's own current visit makes them appear unavailable for that exact same slot", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
    });
    await scheduleVisit(repo, "2026-08-24", "08:00", "cleaner-1"); // Monday

    const result = await findAvailableCleaners(repo, {
      date: "2026-08-24",
      startTime: "08:00",
      serviceMinutes: 120,
      timezone: "America/Chicago",
      // No excludeServiceVisitId — reproduces the bug: the visit's own assignment counts as a conflict against itself.
    });

    expect(result.cleaners.find((c) => c.cleanerId === "cleaner-1")?.available).toBe(false);
  });

  it("FIX: passing excludeServiceVisitId lets the assigned cleaner show as available for their own visit's current (or any non-conflicting) slot", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
    });
    const visitId = await scheduleVisit(repo, "2026-08-24", "08:00", "cleaner-1");

    const sameSlot = await findAvailableCleaners(repo, {
      date: "2026-08-24",
      startTime: "08:00",
      serviceMinutes: 120,
      timezone: "America/Chicago",
      excludeServiceVisitId: visitId,
    });
    expect(sameSlot.cleaners.find((c) => c.cleanerId === "cleaner-1")?.available).toBe(true);

    const laterSlot = await findAvailableCleaners(repo, {
      date: "2026-08-24",
      startTime: "16:00",
      serviceMinutes: 120,
      timezone: "America/Chicago",
      excludeServiceVisitId: visitId,
    });
    expect(laterSlot.cleaners.find((c) => c.cleanerId === "cleaner-1")?.available).toBe(true);
  });

  it("excludeServiceVisitId only excludes that one visit — a genuine conflict with a DIFFERENT visit is still correctly blocked", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-1", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true }],
    });
    const visitAId = await scheduleVisit(repo, "2026-08-24", "08:00", "cleaner-1", "booking-a");
    await scheduleVisit(repo, "2026-08-24", "12:00", "cleaner-1", "booking-b"); // a second, separate visit for the same cleaner

    // Rescheduling visit A to overlap visit B's slot must still be blocked —
    // excluding visit A's own assignment must never also exclude visit B's.
    const result = await findAvailableCleaners(repo, {
      date: "2026-08-24",
      startTime: "12:00",
      serviceMinutes: 120,
      timezone: "America/Chicago",
      excludeServiceVisitId: visitAId,
    });
    expect(result.cleaners.find((c) => c.cleanerId === "cleaner-1")?.available).toBe(false);
  });
});
