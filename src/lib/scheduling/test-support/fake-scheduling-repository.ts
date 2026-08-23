import { randomUUID } from "node:crypto";
import type {
  ActiveAssignmentIntervalRow,
  CleanerAvailabilityExceptionRow,
  CleanerAvailabilityRuleRow,
  CleanerRow,
  NewPackageAmendmentRow,
  NewPackageVisitPlanHistoryRow,
  NewPackageVisitPlanRow,
  NewRecurringScheduleRow,
  NewServiceFeeAssessmentRow,
  NewServiceVisitNotificationRow,
  NewServiceVisitRow,
  PackageAmendmentRow,
  PackageVisitPlanRow,
  PrepaidPackageRow,
  RecurringScheduleRow,
  SchedulingDayOverrideRow,
  ServiceFeeAssessmentRow,
  ServiceVisitEventRow,
  ServiceVisitRow,
} from "../domain-types";
import { SchedulingConflictError } from "../errors";
import type { SchedulingRepository } from "../repository";

interface FakeAssignment {
  id: string;
  serviceVisitId: string;
  cleanerId: string;
  unassignedAt: Date | null;
  confirmedStartAt: Date;
  confirmedEndAt: Date;
  turnaroundBufferMinutes: number;
}

interface FakeNotification {
  idempotencyKey: string;
  serviceVisitId: string;
  state: "pending" | "cancelled";
}

/** One-sided-buffer overlap check, mirroring service_visit_assignments_no_overlap's buffered_range math (see the migration). */
function occupancyOverlap(existing: FakeAssignment, candidateStart: Date, candidateEnd: Date, candidateBufferMinutes: number): boolean {
  const existingBufferedEnd = existing.confirmedEndAt.getTime() + existing.turnaroundBufferMinutes * 60_000;
  const candidateBufferedEnd = candidateEnd.getTime() + candidateBufferMinutes * 60_000;
  return existing.confirmedStartAt.getTime() < candidateBufferedEnd && candidateStart.getTime() < existingBufferedEnd;
}

/**
 * In-memory SchedulingRepository that mirrors the real Postgres semantics
 * this milestone depends on (the service_visit_assignments EXCLUDE
 * constraint's overlap math, complete_service_visit()'s idempotent credit
 * consumption, package_visit_plans' unique-per-visit-number constraint)
 * closely enough to exercise the actual correctness/idempotency properties
 * in unit tests without a real database — same intent as
 * fake-booking-repository.ts.
 */
export function createFakeSchedulingRepository(
  seed: {
    cleaners?: CleanerRow[];
    availabilityRules?: CleanerAvailabilityRuleRow[];
    exceptions?: CleanerAvailabilityExceptionRow[];
    dayOverrides?: SchedulingDayOverrideRow[];
    serviceVisits?: ServiceVisitRow[];
    prepaidPackages?: PrepaidPackageRow[];
  } = {}
) {
  const cleaners = [...(seed.cleaners ?? [])];
  const availabilityRules = [...(seed.availabilityRules ?? [])];
  const exceptions = [...(seed.exceptions ?? [])];
  const dayOverrides = [...(seed.dayOverrides ?? [])];

  const serviceVisitsById = new Map<string, ServiceVisitRow>();
  for (const v of seed.serviceVisits ?? []) serviceVisitsById.set(v.id, v);

  const prepaidPackagesById = new Map<string, PrepaidPackageRow>();
  for (const p of seed.prepaidPackages ?? []) prepaidPackagesById.set(p.id, p);

  const assignments: FakeAssignment[] = [];
  const events: ServiceVisitEventRow[] = [];
  const feeAssessments: ServiceFeeAssessmentRow[] = [];
  const notifications = new Map<string, FakeNotification>();
  const recurringSchedulesById = new Map<string, RecurringScheduleRow>();
  const packageVisitPlansById = new Map<string, PackageVisitPlanRow>();
  const packageVisitPlanHistory: NewPackageVisitPlanHistoryRow[] = [];
  const packageAmendmentsById = new Map<string, PackageAmendmentRow>();
  // Mirrors package_visit_usages.service_visit_id UNIQUE.
  const packageVisitUsages = new Set<string>();

  const repo: SchedulingRepository = {
    async listActiveCleaners() {
      return cleaners.filter((c) => c.active);
    },
    async listActiveAvailabilityRules() {
      return availabilityRules.filter((r) => r.active);
    },
    async listAvailabilityExceptionsForDate(date) {
      return exceptions.filter((e) => e.exceptionDate === date);
    },
    async listDayOverridesForDate(date) {
      return dayOverrides.filter((o) => o.overrideDate === date);
    },
    async listActiveAssignmentsInRange(rangeStartUtc: Date, rangeEndUtc: Date): Promise<ActiveAssignmentIntervalRow[]> {
      return assignments
        .filter(
          (a) =>
            a.unassignedAt === null &&
            a.confirmedStartAt.getTime() >= rangeStartUtc.getTime() &&
            a.confirmedStartAt.getTime() < rangeEndUtc.getTime()
        )
        .map((a) => ({
          cleanerId: a.cleanerId,
          confirmedStartAt: a.confirmedStartAt,
          confirmedEndAt: a.confirmedEndAt,
          turnaroundBufferMinutes: a.turnaroundBufferMinutes,
        }));
    },

    async findServiceVisitById(id) {
      return serviceVisitsById.get(id) ?? null;
    },
    async findDirectServiceVisitByBookingOrderId(bookingOrderId) {
      for (const v of serviceVisitsById.values()) {
        if (v.bookingOrderId === bookingOrderId && v.recurringScheduleId === null) return v;
      }
      return null;
    },
    async insertServiceVisit(row: NewServiceVisitRow) {
      const id = randomUUID();
      const created: ServiceVisitRow = {
        id,
        customerId: row.customerId,
        quoteRequestId: row.quoteRequestId,
        bookingOrderId: row.bookingOrderId,
        prepaidPackageId: row.prepaidPackageId,
        recurringScheduleId: row.recurringScheduleId,
        visitNumber: row.visitNumber,
        cleaningType: row.cleaningType,
        frequency: row.frequency,
        status: "requested",
        requestedStartAt: row.requestedStartAt,
        confirmedAt: null,
        confirmedStartAt: null,
        confirmedEndAt: null,
        estimatedLaborMinutes: null,
        estimatedServiceMinutes: null,
        recommendedCleanerCount: null,
        turnaroundBufferMinutes: null,
        timezone: row.timezone,
        completedAt: null,
        cancelledAt: null,
        serviceAddressLine1: row.serviceAddressLine1,
        serviceAddressLine2: row.serviceAddressLine2,
        serviceCity: row.serviceCity,
        serviceState: row.serviceState,
        serviceAddressIdentity: row.serviceAddressIdentity,
      };
      serviceVisitsById.set(id, created);
      return created;
    },

    async setServiceVisitSchedule(params) {
      const visit = serviceVisitsById.get(params.serviceVisitId);
      if (!visit || (visit.status !== "requested" && visit.status !== "scheduled")) {
        throw new Error(`service_visit ${params.serviceVisitId} is not in a confirmable state (must be requested or scheduled)`);
      }
      if (params.cleanerIds.length === 0) {
        throw new Error("set_service_visit_schedule requires at least one cleaner");
      }
      if (params.confirmedEndAt.getTime() <= params.confirmedStartAt.getTime()) {
        throw new Error("confirmedEndAt must be after confirmedStartAt");
      }

      // Conflict-check FIRST (mirrors the Postgres EXCLUDE constraint firing
      // atomically before any row is actually committed) — same-cleaner
      // active assignments on OTHER visits must not overlap.
      for (const cleanerId of params.cleanerIds) {
        const conflict = assignments.find(
          (a) =>
            a.cleanerId === cleanerId &&
            a.unassignedAt === null &&
            a.serviceVisitId !== params.serviceVisitId &&
            occupancyOverlap(a, params.confirmedStartAt, params.confirmedEndAt, params.turnaroundBufferMinutes)
        );
        if (conflict) {
          throw new SchedulingConflictError();
        }
      }

      // Unassign cleaners no longer in the set.
      for (const a of assignments) {
        if (a.serviceVisitId === params.serviceVisitId && a.unassignedAt === null && !params.cleanerIds.includes(a.cleanerId)) {
          a.unassignedAt = new Date();
        }
      }

      for (const cleanerId of params.cleanerIds) {
        const existing = assignments.find(
          (a) => a.serviceVisitId === params.serviceVisitId && a.cleanerId === cleanerId && a.unassignedAt === null
        );
        if (existing) {
          existing.confirmedStartAt = params.confirmedStartAt;
          existing.confirmedEndAt = params.confirmedEndAt;
          existing.turnaroundBufferMinutes = params.turnaroundBufferMinutes;
        } else {
          assignments.push({
            id: randomUUID(),
            serviceVisitId: params.serviceVisitId,
            cleanerId,
            unassignedAt: null,
            confirmedStartAt: params.confirmedStartAt,
            confirmedEndAt: params.confirmedEndAt,
            turnaroundBufferMinutes: params.turnaroundBufferMinutes,
          });
        }
      }

      serviceVisitsById.set(params.serviceVisitId, {
        ...visit,
        status: "scheduled",
        confirmedAt: new Date(),
        confirmedStartAt: params.confirmedStartAt,
        confirmedEndAt: params.confirmedEndAt,
        estimatedLaborMinutes: params.estimatedLaborMinutes,
        estimatedServiceMinutes: params.estimatedServiceMinutes,
        recommendedCleanerCount: params.recommendedCleanerCount,
        turnaroundBufferMinutes: params.turnaroundBufferMinutes,
      });
    },

    async completeServiceVisitRpc(serviceVisitId) {
      const visit = serviceVisitsById.get(serviceVisitId);
      if (!visit || visit.status !== "scheduled") {
        return; // idempotent no-op, mirrors complete_service_visit()
      }
      serviceVisitsById.set(serviceVisitId, { ...visit, status: "completed", completedAt: new Date() });

      if (visit.prepaidPackageId && !packageVisitUsages.has(serviceVisitId)) {
        packageVisitUsages.add(serviceVisitId);
        const pkg = prepaidPackagesById.get(visit.prepaidPackageId);
        if (pkg && pkg.remainingVisitCount > 0) {
          prepaidPackagesById.set(pkg.id, { ...pkg, remainingVisitCount: pkg.remainingVisitCount - 1 });
        }
      }
    },

    async cancelServiceVisit(serviceVisitId) {
      const visit = serviceVisitsById.get(serviceVisitId);
      if (!visit || visit.status === "completed" || visit.status === "cancelled") {
        return false;
      }
      serviceVisitsById.set(serviceVisitId, { ...visit, status: "cancelled", cancelledAt: new Date() });
      for (const a of assignments) {
        if (a.serviceVisitId === serviceVisitId && a.unassignedAt === null) a.unassignedAt = new Date();
      }
      return true;
    },

    async insertServiceVisitEvent(row) {
      events.push(row);
    },
    async insertServiceFeeAssessment(row: NewServiceFeeAssessmentRow) {
      const created: ServiceFeeAssessmentRow = { id: randomUUID(), state: "assessed", ...row };
      feeAssessments.push(created);
      return created;
    },
    async updateServiceFeeAssessmentState(id, state, reasonAppend) {
      const index = feeAssessments.findIndex((f) => f.id === id);
      if (index === -1) return null;
      const existing = feeAssessments[index];
      const updated: ServiceFeeAssessmentRow = {
        ...existing,
        state,
        reason: reasonAppend ? (existing.reason ? `${existing.reason} — ${reasonAppend}` : reasonAppend) : existing.reason,
      };
      feeAssessments[index] = updated;
      return updated;
    },
    async insertServiceVisitNotification(row: NewServiceVisitNotificationRow) {
      if (notifications.has(row.idempotencyKey)) {
        return { inserted: false };
      }
      notifications.set(row.idempotencyKey, { idempotencyKey: row.idempotencyKey, serviceVisitId: row.serviceVisitId, state: "pending" });
      return { inserted: true };
    },
    async cancelPendingServiceVisitNotifications(serviceVisitId) {
      for (const n of notifications.values()) {
        if (n.serviceVisitId === serviceVisitId && n.state === "pending") n.state = "cancelled";
      }
    },

    async insertRecurringSchedule(row: NewRecurringScheduleRow) {
      const id = randomUUID();
      const created: RecurringScheduleRow = { id, status: "active", effectiveUntil: null, ...row };
      recurringSchedulesById.set(id, created);
      return created;
    },
    async findRecurringScheduleById(id) {
      return recurringSchedulesById.get(id) ?? null;
    },
    async findActiveRecurringScheduleForBookingOrder(bookingOrderId) {
      for (const r of recurringSchedulesById.values()) {
        if (r.bookingOrderId === bookingOrderId && r.status === "active") return r;
      }
      return null;
    },
    async findActiveRecurringScheduleForPackage(prepaidPackageId) {
      for (const r of recurringSchedulesById.values()) {
        if (r.prepaidPackageId === prepaidPackageId && r.status === "active") return r;
      }
      return null;
    },
    async supersedeRecurringSchedule(id, effectiveUntil) {
      const existing = recurringSchedulesById.get(id);
      if (existing) recurringSchedulesById.set(id, { ...existing, status: "superseded", effectiveUntil });
    },

    async findPrepaidPackageById(id) {
      return prepaidPackagesById.get(id) ?? null;
    },
    async listPackageVisitPlans(prepaidPackageId) {
      return [...packageVisitPlansById.values()]
        .filter((p) => p.prepaidPackageId === prepaidPackageId)
        .sort((a, b) => a.visitNumber - b.visitNumber);
    },
    async findPackageVisitPlanById(id) {
      return packageVisitPlansById.get(id) ?? null;
    },
    async insertPackageVisitPlan(row: NewPackageVisitPlanRow) {
      const existing = [...packageVisitPlansById.values()].find(
        (p) => p.prepaidPackageId === row.prepaidPackageId && p.visitNumber === row.visitNumber
      );
      if (existing) {
        return { plan: existing, inserted: false };
      }
      const id = randomUUID();
      const created: PackageVisitPlanRow = {
        id,
        prepaidPackageId: row.prepaidPackageId,
        visitNumber: row.visitNumber,
        plannedDate: row.plannedDate,
        plannedStartTime: row.plannedStartTime,
        status: "planned",
        serviceVisitId: null,
        generatedFromRecurringScheduleId: row.generatedFromRecurringScheduleId,
      };
      packageVisitPlansById.set(id, created);
      return { plan: created, inserted: true };
    },
    async updatePackageVisitPlan(id, patch) {
      const existing = packageVisitPlansById.get(id);
      if (!existing) return;
      packageVisitPlansById.set(id, {
        ...existing,
        plannedDate: patch.plannedDate ?? existing.plannedDate,
        plannedStartTime: patch.plannedStartTime ?? existing.plannedStartTime,
        status: patch.status ?? existing.status,
        serviceVisitId: patch.serviceVisitId ?? existing.serviceVisitId,
      });
    },
    async insertPackageVisitPlanHistory(row) {
      packageVisitPlanHistory.push(row);
    },

    async insertPackageAmendment(row: NewPackageAmendmentRow) {
      const id = randomUUID();
      const created: PackageAmendmentRow = {
        id,
        approvalState: "pending_customer_approval",
        paymentState:
          row.valueDifference > 0 ? "additional_payment_pending" : row.valueDifference < 0 ? "refund_pending" : "not_required",
        newRecurringScheduleId: null,
        ...row,
      };
      packageAmendmentsById.set(id, created);
      return created;
    },
    async findPackageAmendmentById(id) {
      return packageAmendmentsById.get(id) ?? null;
    },
    async updatePackageAmendmentState(id, patch) {
      const existing = packageAmendmentsById.get(id);
      if (!existing) return null;
      const updated: PackageAmendmentRow = {
        ...existing,
        approvalState: patch.approvalState ?? existing.approvalState,
        paymentState: patch.paymentState ?? existing.paymentState,
      };
      packageAmendmentsById.set(id, updated);
      return updated;
    },
  };

  return {
    repo,
    state: {
      cleaners,
      availabilityRules,
      exceptions,
      dayOverrides,
      serviceVisitsById,
      assignments,
      events,
      feeAssessments,
      notifications,
      recurringSchedulesById,
      packageVisitPlansById,
      packageVisitPlanHistory,
      packageAmendmentsById,
      prepaidPackagesById,
      packageVisitUsages,
    },
  };
}
