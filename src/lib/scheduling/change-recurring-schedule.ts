import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import type { RecurringScheduleRow } from "./domain-types";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

export interface ChangeRecurringScheduleInput {
  currentScheduleId: string;
  newCadence: RecurringCadence;
  newPreferredDayOfWeek: number;
  newPreferredStartTime: TimeOfDay;
  /** The date the new cadence/day/time takes effect for future-generated visits. Already-created service_visits are never touched by this — see change-recurring-schedule vs a single visit's own reschedule. */
  effectiveFrom: CalendarDate;
}

/**
 * "Change this and future visits": creates a NEW recurring_schedules row
 * (supersedes_id -> the current one) and marks the current row
 * status='superseded' with effective_until = the new row's effective_from
 * — never mutates cadence/day/time on an existing row in place, preserving
 * the full version history. Already-created service_visits (confirmed or
 * merely requested) are never touched here; a specific visit's own date
 * moving is reschedule-service-visit.ts's job ("change only this one
 * visit"), which never touches this table at all.
 */
export async function changeRecurringSchedule(
  repo: SchedulingRepository,
  input: ChangeRecurringScheduleInput
): Promise<RecurringScheduleRow> {
  const current = await repo.findRecurringScheduleById(input.currentScheduleId);
  if (!current || current.status !== "active") {
    throw new InvalidVisitStateError(`recurring_schedule ${input.currentScheduleId} is not active`);
  }

  const created = await repo.insertRecurringSchedule({
    customerId: current.customerId,
    bookingOrderId: current.bookingOrderId,
    prepaidPackageId: current.prepaidPackageId,
    cadence: input.newCadence,
    preferredDayOfWeek: input.newPreferredDayOfWeek,
    preferredStartTime: input.newPreferredStartTime,
    timezone: current.timezone,
    effectiveFrom: input.effectiveFrom,
    supersedesId: current.id,
  });

  await repo.supersedeRecurringSchedule(current.id, input.effectiveFrom);

  return created;
}
