import { InvalidVisitStateError } from "./errors";
import { addCadenceInterval } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import { utcToZonedDateTime, zonedDateTimeToUtc } from "./timezone";

/**
 * Generates the NEXT occurrence in a recurring series, on demand — only
 * when the previous visit has actually completed or been cancelled, never
 * a pre-generated rolling window (per the spec's explicit "do not
 * pre-generate indefinite months/years of real service_visits" rule). The
 * next date is computed from the PREVIOUS visit's own date (not "today"),
 * so a late completion never shifts the rest of the series. Returns null
 * when the previous visit isn't part of a recurring series, or when its
 * recurring_schedules template has been paused/cancelled.
 */
export async function generateRecurringNextVisit(
  repo: SchedulingRepository,
  previousServiceVisitId: string
): Promise<{ visitId: string } | null> {
  const previous = await repo.findServiceVisitById(previousServiceVisitId);
  if (!previous) {
    throw new InvalidVisitStateError(`service_visit ${previousServiceVisitId} not found`);
  }

  // The very first visit of a recurring series (created directly by
  // create-requested-visit-from-booking.ts) deliberately carries
  // recurringScheduleId=null — see that file's comment on why. Every
  // LATER recurring-generated visit does carry it. So resolve the
  // template either way: prefer the visit's own link when present, else
  // look it up via whichever of bookingOrderId/prepaidPackageId this
  // visit belongs to.
  const schedule = previous.recurringScheduleId
    ? await repo.findRecurringScheduleById(previous.recurringScheduleId)
    : previous.bookingOrderId
      ? await repo.findActiveRecurringScheduleForBookingOrder(previous.bookingOrderId)
      : previous.prepaidPackageId
        ? await repo.findActiveRecurringScheduleForPackage(previous.prepaidPackageId)
        : null;
  if (!schedule) {
    return null;
  }

  if (previous.status !== "completed" && previous.status !== "cancelled") {
    throw new InvalidVisitStateError(
      `service_visit ${previousServiceVisitId} must be completed or cancelled before generating its next occurrence`
    );
  }

  if (schedule.status === "cancelled" || schedule.status === "paused") {
    return null;
  }

  const baseInstant = previous.confirmedStartAt ?? previous.requestedStartAt;
  const previousLocalDate = baseInstant ? utcToZonedDateTime(baseInstant, schedule.timezone).date : schedule.effectiveFrom;
  const nextDate = addCadenceInterval(previousLocalDate, schedule.cadence);

  const requestedStartAt = zonedDateTimeToUtc(nextDate, schedule.preferredStartTime, schedule.timezone);

  const visit = await repo.insertServiceVisit({
    customerId: previous.customerId,
    quoteRequestId: previous.quoteRequestId,
    bookingOrderId: previous.bookingOrderId,
    prepaidPackageId: previous.prepaidPackageId,
    recurringScheduleId: schedule.id,
    visitNumber: null,
    cleaningType: previous.cleaningType,
    frequency: previous.frequency,
    requestedStartAt,
    timezone: schedule.timezone,
    serviceAddressLine1: previous.serviceAddressLine1,
    serviceAddressLine2: previous.serviceAddressLine2,
    serviceCity: previous.serviceCity,
    serviceState: previous.serviceState,
    serviceAddressIdentity: previous.serviceAddressIdentity,
  });

  await repo.insertServiceVisitEvent({
    serviceVisitId: visit.id,
    eventType: "requested",
    actor: "system",
    previousState: null,
    newState: { requestedStartAt: requestedStartAt.toISOString(), generatedFromServiceVisitId: previousServiceVisitId },
    notes: null,
  });

  return { visitId: visit.id };
}
