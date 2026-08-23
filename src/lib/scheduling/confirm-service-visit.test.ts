import { describe, expect, it } from "vitest";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { SchedulingConflictError } from "./errors";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedRequestedVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"], bookingOrderId = "booking-1") {
  const { visitId } = await createRequestedVisitFromBooking(repo, {
    bookingOrderId,
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    cleaningType: "standard",
    frequency: "one_time",
    requestedDate: "2026-08-24",
    requestedStartTime: "10:00",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  return visitId;
}

describe("confirmServiceVisit", () => {
  it("transitions a requested visit to scheduled with confirmed timing and cleaner assignment", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit(repo);

    await confirmServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-08-24",
      startTime: "10:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
    });

    const visit = state.serviceVisitsById.get(visitId);
    expect(visit?.status).toBe("scheduled");
    expect(visit?.confirmedStartAt).not.toBeNull();
    expect(state.assignments.some((a) => a.serviceVisitId === visitId && a.cleanerId === "cleaner-1")).toBe(true);
  });

  it("logs a 'confirmed' event", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit(repo);
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    expect(state.events.some((e) => e.serviceVisitId === visitId && e.eventType === "confirmed")).toBe(true);
  });

  it("schedules a pending 24-hour reminder on confirmation", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit(repo);
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    const pending = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.state === "pending");
    expect(pending.length).toBe(1);
  });

  it("rejects a double-booking: two visits confirmed to overlap for the same cleaner", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitA = await seedRequestedVisit(repo, "booking-a");
    const visitB = await seedRequestedVisit(repo, "booking-b");

    await confirmServiceVisit(repo, { serviceVisitId: visitA, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

    await expect(
      confirmServiceVisit(repo, { serviceVisitId: visitB, date: "2026-08-24", startTime: "10:30", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT })
    ).rejects.toThrow(SchedulingConflictError);
  });

  it("allows a non-overlapping assignment for the same cleaner", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitA = await seedRequestedVisit(repo, "booking-a");
    const visitB = await seedRequestedVisit(repo, "booking-b");

    await confirmServiceVisit(repo, { serviceVisitId: visitA, date: "2026-08-24", startTime: "08:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await confirmServiceVisit(repo, { serviceVisitId: visitB, date: "2026-08-24", startTime: "14:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

    expect(state.serviceVisitsById.get(visitB)?.status).toBe("scheduled");
  });
});
