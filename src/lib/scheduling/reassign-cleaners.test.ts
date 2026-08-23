import { describe, expect, it } from "vitest";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { SchedulingConflictError } from "./errors";
import { reassignCleaners } from "./reassign-cleaners";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedScheduledVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"], bookingOrderId: string, cleanerIds: string[]) {
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
  await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds, durationInput: DURATION_INPUT });
  return visitId;
}

describe("reassignCleaners", () => {
  it("swaps the assigned cleaner without changing confirmed timing", async () => {
    const { repo, state } = createFakeSchedulingRepository({
      cleaners: [
        { id: "cleaner-1", name: "A", active: true },
        { id: "cleaner-2", name: "B", active: true },
      ],
    });
    const visitId = await seedScheduledVisit(repo, "booking-1", ["cleaner-1"]);
    const before = state.serviceVisitsById.get(visitId)?.confirmedStartAt;

    await reassignCleaners(repo, { serviceVisitId: visitId, cleanerIds: ["cleaner-2"] });

    const active = state.assignments.filter((a) => a.serviceVisitId === visitId && a.unassignedAt === null);
    expect(active.map((a) => a.cleanerId)).toEqual(["cleaner-2"]);
    expect(state.serviceVisitsById.get(visitId)?.confirmedStartAt?.getTime()).toBe(before?.getTime());
  });

  it("logs a 'cleaner_reassigned' event", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }, { id: "cleaner-2", name: "B", active: true }] });
    const visitId = await seedScheduledVisit(repo, "booking-1", ["cleaner-1"]);
    await reassignCleaners(repo, { serviceVisitId: visitId, cleanerIds: ["cleaner-2"] });
    expect(state.events.some((e) => e.serviceVisitId === visitId && e.eventType === "cleaner_reassigned")).toBe(true);
  });

  it("rejects a reassignment that would double-book the new cleaner", async () => {
    const { repo } = createFakeSchedulingRepository({
      cleaners: [
        { id: "cleaner-1", name: "A", active: true },
        { id: "cleaner-2", name: "B", active: true },
      ],
    });
    const visitA = await seedScheduledVisit(repo, "booking-a", ["cleaner-1"]);
    await seedScheduledVisit(repo, "booking-b", ["cleaner-2"]); // same 10:00 slot as visitA

    await expect(reassignCleaners(repo, { serviceVisitId: visitA, cleanerIds: ["cleaner-2"] })).rejects.toThrow(SchedulingConflictError);
  });
});
