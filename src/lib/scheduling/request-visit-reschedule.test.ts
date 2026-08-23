import { describe, expect, it } from "vitest";
import { confirmServiceVisit } from "./confirm-service-visit";
import { InvalidVisitStateError } from "./errors";
import { requestVisitReschedule } from "./request-visit-reschedule";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

describe("requestVisitReschedule", () => {
  it("updates requested_start_at only — confirmed_start_at/status/assignments stay untouched", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
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
    await confirmServiceVisit(repo, { serviceVisitId: visit.id, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

    await requestVisitReschedule(repo, { serviceVisitId: visit.id, newDate: "2026-08-26", newStartTime: "14:00" });

    const updated = state.serviceVisitsById.get(visit.id);
    expect(updated?.status).toBe("scheduled");
    expect(updated?.confirmedStartAt?.toISOString().slice(0, 10)).toBe("2026-08-24");
    expect(updated?.requestedStartAt?.toISOString().slice(0, 10)).toBe("2026-08-26");

    const activeAssignments = state.assignments.filter((a) => a.serviceVisitId === visit.id && a.unassignedAt === null);
    expect(activeAssignments.length).toBe(1);
  });

  it("logs a reschedule_requested event distinct from an admin's actual rescheduled event", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
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
    await confirmServiceVisit(repo, { serviceVisitId: visit.id, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

    await requestVisitReschedule(repo, { serviceVisitId: visit.id, newDate: "2026-08-26", newStartTime: "14:00" });

    expect(state.events.some((e) => e.eventType === "reschedule_requested" && e.actor === "customer")).toBe(true);
  });

  it("allows updating the preferred date on a visit that is only 'requested' (not yet admin-confirmed)", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
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

    await requestVisitReschedule(repo, { serviceVisitId: visit.id, newDate: "2026-08-26", newStartTime: "14:00" });

    const updated = state.serviceVisitsById.get(visit.id);
    expect(updated?.status).toBe("requested");
    expect(updated?.requestedStartAt?.toISOString().slice(0, 10)).toBe("2026-08-26");
  });

  it("refuses to request a reschedule against a completed or cancelled visit", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
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
    await repo.cancelServiceVisit(visit.id);

    await expect(requestVisitReschedule(repo, { serviceVisitId: visit.id, newDate: "2026-08-26", newStartTime: "14:00" })).rejects.toThrow(
      InvalidVisitStateError
    );
  });
});
