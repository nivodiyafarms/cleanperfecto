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
    const pending = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visitId && n.notificationType === "reminder_24h" && n.state === "pending"
    );
    expect(pending.length).toBe(1);
  });

  it("enqueues exactly one pending appointment_confirmed notice on a genuine requested -> scheduled confirmation", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit(repo);
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    const confirmedNotices = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visitId && n.notificationType === "appointment_confirmed"
    );
    expect(confirmedNotices.length).toBe(1);
    expect(confirmedNotices[0].state).toBe("pending");
  });

  it("does not enqueue a second appointment_confirmed notice when re-confirming an already-scheduled visit", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit(repo);
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    const confirmedNotices = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visitId && n.notificationType === "appointment_confirmed"
    );
    expect(confirmedNotices.length).toBe(1);
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

describe("confirmServiceVisit — requireAvailabilityCheck (admin custom start time re-validation)", () => {
  // Monday-Sunday, wide hours — isolates each test's scenario to the specific
  // constraint under test rather than day-of-week/hours incidentally failing it.
  const WIDE_RULES = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    id: `rule-${dayOfWeek}`,
    cleanerId: "cleaner-1",
    dayOfWeek,
    startTime: "00:00",
    endTime: "23:59",
    active: true,
  }));
  const SHORT_DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "studio_1ba" as const, condition: "light" as const }; // 90 min

  it("does NOT re-validate by default — every existing/internal caller is unaffected", async () => {
    // Zero availability rules seeded at all; confirms without requireAvailabilityCheck.
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit(repo);
    await expect(
      confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT })
    ).resolves.not.toThrow();
  });

  it("a valid admin-chosen custom time is accepted and the visit is confirmed", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }], availabilityRules: WIDE_RULES });
    const visitId = await seedRequestedVisit(repo);

    await confirmServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-08-24",
      startTime: "12:33", // an arbitrary, non-grid-generated "custom" minute
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      requireAvailabilityCheck: true,
    });

    expect(state.serviceVisitsById.get(visitId)?.status).toBe("scheduled");
  });

  it("rejects a custom time that conflicts with an existing appointment (via the same engine, not just the DB constraint)", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }], availabilityRules: WIDE_RULES });
    const visitA = await seedRequestedVisit(repo, "booking-a");
    const visitB = await seedRequestedVisit(repo, "booking-b");

    await confirmServiceVisit(repo, { serviceVisitId: visitA, date: "2026-08-24", startTime: "08:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT }); // occupies 08:00-10:30

    await expect(
      confirmServiceVisit(repo, {
        serviceVisitId: visitB,
        date: "2026-08-24",
        startTime: "09:00", // squarely inside visitA's occupied window
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).rejects.toThrow(SchedulingConflictError);

    // Rejected before any write — visitB is left exactly as it was.
    expect(state.serviceVisitsById.get(visitB)?.status).toBe("requested");
  });

  it("rejects a custom time outside the selected cleaner's declared working hours", async () => {
    const { repo, state } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: [{ id: "rule-mon", cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "09:00", endTime: "12:00", active: true }], // 2026-08-24 is a Monday
    });
    const visitId = await seedRequestedVisit(repo);

    await expect(
      confirmServiceVisit(repo, {
        serviceVisitId: visitId,
        date: "2026-08-24",
        startTime: "14:00", // outside the 09:00-12:00 rule entirely
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).rejects.toThrow(SchedulingConflictError);
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("requested");
  });

  it("factors the appointment's own duration into the conflict check — the same start time is valid for a short job and invalid for a longer one against the same later appointment", async () => {
    const laterAppointment = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }], availabilityRules: WIDE_RULES });
    const laterVisit = await seedRequestedVisit(laterAppointment.repo, "booking-later");
    await confirmServiceVisit(laterAppointment.repo, {
      serviceVisitId: laterVisit,
      date: "2026-08-24",
      startTime: "13:00",
      cleanerIds: ["cleaner-1"],
      durationInput: SHORT_DURATION_INPUT, // occupies 13:00-14:30 (buffered) either way
    });

    const candidateVisitShort = await seedRequestedVisit(laterAppointment.repo, "booking-short");
    // Short (90 min) job at 10:00 ends 11:30, +60 buffer = 12:30 -- clears the 13:00 appointment.
    await expect(
      confirmServiceVisit(laterAppointment.repo, {
        serviceVisitId: candidateVisitShort,
        date: "2026-08-24",
        startTime: "10:00",
        cleanerIds: ["cleaner-1"],
        durationInput: SHORT_DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).resolves.not.toThrow();

    const candidateVisitLong = await seedRequestedVisit(laterAppointment.repo, "booking-long");
    // Long (150 min) job at the SAME 10:00 start ends 12:30, +60 buffer = 13:30 -- now reaches into the 13:00 appointment.
    await expect(
      confirmServiceVisit(laterAppointment.repo, {
        serviceVisitId: candidateVisitLong,
        date: "2026-08-24",
        startTime: "10:00",
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).rejects.toThrow(SchedulingConflictError);
  });

  it("enforces the required scheduling buffer, not just raw start/end overlap", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }], availabilityRules: WIDE_RULES });
    const visitA = await seedRequestedVisit(repo, "booking-a");
    await confirmServiceVisit(repo, { serviceVisitId: visitA, date: "2026-08-24", startTime: "08:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT }); // raw end 10:30, buffered end 11:30

    const rightAfterRawEnd = await seedRequestedVisit(repo, "booking-buffer-violation");
    await expect(
      confirmServiceVisit(repo, {
        serviceVisitId: rightAfterRawEnd,
        date: "2026-08-24",
        startTime: "10:30", // after the raw end, but inside the 60-minute buffer
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).rejects.toThrow(SchedulingConflictError);

    const pastBuffer = await seedRequestedVisit(repo, "booking-buffer-clear");
    await expect(
      confirmServiceVisit(repo, {
        serviceVisitId: pastBuffer,
        date: "2026-08-24",
        startTime: "11:30", // exactly at the buffered boundary
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).resolves.not.toThrow();
  });

  it("rejects when the day is closed via a business-level day override", async () => {
    const { repo, state } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      availabilityRules: WIDE_RULES,
      dayOverrides: [{ id: "override-1", overrideDate: "2026-08-24", type: "closed_all_day", blockStartTime: null, blockEndTime: null }],
    });
    const visitId = await seedRequestedVisit(repo);

    await expect(
      confirmServiceVisit(repo, {
        serviceVisitId: visitId,
        date: "2026-08-24",
        startTime: "10:00",
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
        requireAvailabilityCheck: true,
      })
    ).rejects.toThrow(/closed/i);
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("requested");
  });
});
