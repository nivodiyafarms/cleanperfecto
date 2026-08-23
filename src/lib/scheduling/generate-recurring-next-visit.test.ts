import { describe, expect, it } from "vitest";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { generateRecurringNextVisit } from "./generate-recurring-next-visit";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

describe("generateRecurringNextVisit", () => {
  it("returns null for a non-recurring (one_time) visit", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
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
    await expect(generateRecurringNextVisit(repo, visitId)).resolves.toBeNull();
  });

  it("generates a 'requested' visit one weekly cadence interval after the completed previous visit's date", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { visitId } = await createRequestedVisitFromBooking(repo, {
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
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await completeServiceVisit(repo, visitId);

    const result = await generateRecurringNextVisit(repo, visitId);
    expect(result).not.toBeNull();
    const next = state.serviceVisitsById.get((result as { visitId: string }).visitId);
    expect(next?.status).toBe("requested");
    const nextLocalDate = next?.requestedStartAt?.toISOString().slice(0, 10);
    expect(nextLocalDate).toBe("2026-08-31");
  });

  it("throws when the previous visit is still requested/scheduled (not yet completed or cancelled)", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { visitId } = await createRequestedVisitFromBooking(repo, {
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
    await expect(generateRecurringNextVisit(repo, visitId)).rejects.toThrow();
  });
});
