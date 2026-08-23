import type { CleaningType, FrequencyId } from "@/lib/pricing/types";
import { dayOfWeekForDate } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import { zonedDateTimeToUtc } from "./timezone";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

const DEFAULT_TIMEZONE = "America/Chicago";
const RECURRING_FREQUENCIES: FrequencyId[] = ["weekly", "biweekly", "every_4_weeks"];

export interface CreateRequestedVisitFromBookingInput {
  bookingOrderId: string;
  customerId: string;
  quoteRequestId: string;
  cleaningType: CleaningType;
  frequency: FrequencyId;
  requestedDate: CalendarDate;
  requestedStartTime: TimeOfDay;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
}

/**
 * Creates the initial 'requested' service_visits row from a normal
 * booking_order once its Stripe payment-method setup succeeds — see the
 * integration point in process-stripe-webhook-event.ts. For a recurring
 * frequency, also creates the initial recurring_schedules row so "customer
 * establishes a recurring preferred day/time" happens automatically for a
 * normal booking, derived from the requested date's day-of-week and
 * requested start time (nothing new to collect).
 *
 * Idempotent: findDirectServiceVisitByBookingOrderId is checked first
 * (application-level guard, safe if a prior attempt for this booking order
 * failed partway through before the caller's own status transition
 * completed), and service_visits_one_direct_visit_per_booking_order is the
 * DB-level backstop — the same two-layer idempotency pattern used
 * throughout this schema.
 */
export async function createRequestedVisitFromBooking(
  repo: SchedulingRepository,
  input: CreateRequestedVisitFromBookingInput
): Promise<{ visitId: string; recurringScheduleId: string | null }> {
  const existing = await repo.findDirectServiceVisitByBookingOrderId(input.bookingOrderId);
  if (existing) {
    return { visitId: existing.id, recurringScheduleId: existing.recurringScheduleId };
  }

  let recurringScheduleId: string | null = null;
  if (RECURRING_FREQUENCIES.includes(input.frequency)) {
    const existingSchedule = await repo.findActiveRecurringScheduleForBookingOrder(input.bookingOrderId);
    if (existingSchedule) {
      recurringScheduleId = existingSchedule.id;
    } else {
      const created = await repo.insertRecurringSchedule({
        customerId: input.customerId,
        bookingOrderId: input.bookingOrderId,
        prepaidPackageId: null,
        cadence: input.frequency as RecurringCadence,
        preferredDayOfWeek: dayOfWeekForDate(input.requestedDate),
        preferredStartTime: input.requestedStartTime,
        timezone: DEFAULT_TIMEZONE,
        effectiveFrom: input.requestedDate,
        supersedesId: null,
      });
      recurringScheduleId = created.id;
    }
  }

  const requestedStartAt = zonedDateTimeToUtc(input.requestedDate, input.requestedStartTime, DEFAULT_TIMEZONE);

  const visit = await repo.insertServiceVisit({
    customerId: input.customerId,
    quoteRequestId: input.quoteRequestId,
    bookingOrderId: input.bookingOrderId,
    prepaidPackageId: null,
    // The DIRECT visit itself stays unlinked from the template (null) —
    // service_visits_one_direct_visit_per_booking_order relies on exactly
    // this to distinguish "the one direct visit" from later
    // recurring-generated visits, which DO carry recurringScheduleId.
    recurringScheduleId: null,
    visitNumber: null,
    cleaningType: input.cleaningType,
    frequency: input.frequency,
    requestedStartAt,
    timezone: DEFAULT_TIMEZONE,
    serviceAddressLine1: input.serviceAddressLine1,
    serviceAddressLine2: input.serviceAddressLine2,
    serviceCity: input.serviceCity,
    serviceState: input.serviceState,
    serviceAddressIdentity: input.serviceAddressIdentity,
  });

  await repo.insertServiceVisitEvent({
    serviceVisitId: visit.id,
    eventType: "requested",
    actor: "system",
    previousState: null,
    newState: { requestedStartAt: requestedStartAt.toISOString() },
    notes: null,
  });

  return { visitId: visit.id, recurringScheduleId };
}
