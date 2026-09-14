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
  NewRecurringScopeVersionRow,
  NewRecurringVisitPlanHistoryRow,
  NewRecurringVisitPlanRow,
  NewServiceFeeAssessmentRow,
  NewServiceVisitNotificationRow,
  NewServiceVisitPaymentRow,
  NewServiceVisitPricingRow,
  NewServiceVisitRow,
  PackageAmendmentRow,
  PackageVisitPlanRow,
  PrepaidPackageRow,
  RecurringScheduleRow,
  RecurringScopeVersionRow,
  RecurringVisitPlanRow,
  SchedulingDayOverrideRow,
  ServiceFeeAssessmentRow,
  ServiceVisitEventRow,
  ServiceVisitNotificationRow,
  ServiceVisitPaymentExternalSettlementPatch,
  ServiceVisitPaymentRow,
  ServiceVisitPaymentStripeCardFreezePatch,
  ServiceVisitPaymentTaxSyncPatch,
  ServiceVisitPaymentTipPatch,
  ServiceVisitPricingRow,
  ServiceVisitRow,
  StripeDisputeRow,
  TaxReversalReconciliationRow,
} from "../domain-types";
import { InvalidVisitStateError, SchedulingConflictError } from "../errors";
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

type FakeNotification = ServiceVisitNotificationRow;

/**
 * In-memory mirror of financial_audit_log — this fake has no real Postgres
 * table backing it, so recordExternalServiceVisitPaymentWithAudit simulates
 * the real RPC's transactional guarantee itself (see financialAuditControl
 * below) rather than relying on a real database transaction.
 */
export interface FakeFinancialAuditLogRow {
  id: string;
  actorAdminUserId: string;
  actorRole: string;
  actionType: string;
  targetEntityType: string;
  targetEntityId: string;
  serviceVisitId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
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

  const recurringVisitPlansById = new Map<string, RecurringVisitPlanRow>();
  const recurringVisitPlanHistory: NewRecurringVisitPlanHistoryRow[] = [];
  const recurringScopeVersionsById = new Map<string, RecurringScopeVersionRow>();
  const servicePricingByVisitId = new Map<string, ServiceVisitPricingRow>();
  const paymentsByVisitId = new Map<string, ServiceVisitPaymentRow>();
  const taxReversalReconciliationsById = new Map<string, TaxReversalReconciliationRow>();
  const stripeDisputesByStripeDisputeId = new Map<string, StripeDisputeRow>();
  const financialAuditLog: FakeFinancialAuditLogRow[] = [];
  // A live-reference object (not a plain boolean) so a test can flip
  // `state.financialAuditControl.simulateFailure = true` AFTER this fake
  // was constructed and have the repo closure below observe it — mirrors
  // the real RPC's atomicity: when true, recordExternalServiceVisitPaymentWithAudit
  // throws WITHOUT mutating paymentsByVisitId, servicePricingByVisitId, or
  // financialAuditLog at all (every mutation is computed first, then
  // committed together only if nothing failed).
  const financialAuditControl = { simulateFailure: false };

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
    async listServiceVisitsForCustomer(customerId) {
      return [...serviceVisitsById.values()].filter((v) => v.customerId === customerId).reverse();
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
        reviewRequestSuppressed: false,
      };
      serviceVisitsById.set(id, created);
      return created;
    },

    async updateServiceVisitRequestedStart(serviceVisitId, requestedStartAt) {
      const visit = serviceVisitsById.get(serviceVisitId);
      if (!visit) return;
      serviceVisitsById.set(serviceVisitId, { ...visit, requestedStartAt });
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

    async setReviewRequestSuppressed(serviceVisitId, suppressed) {
      const visit = serviceVisitsById.get(serviceVisitId);
      if (visit) serviceVisitsById.set(serviceVisitId, { ...visit, reviewRequestSuppressed: suppressed });
    },

    async insertServiceVisitEvent(row) {
      events.push(row);
    },
    async insertServiceFeeAssessment(row: NewServiceFeeAssessmentRow) {
      const created: ServiceFeeAssessmentRow = { id: randomUUID(), state: "assessed", ...row };
      feeAssessments.push(created);
      return created;
    },
    async waiveServiceFeeAssessmentWithAudit(id, reason, audit) {
      const index = feeAssessments.findIndex((f) => f.id === id);
      if (index === -1) throw new InvalidVisitStateError(`service_fee_assessments ${id} not found`);
      const existing = feeAssessments[index];
      if (existing.state !== "assessed") {
        throw new InvalidVisitStateError(
          `service_fee_assessments ${id} is not eligible for waiver (state=${existing.state})`
        );
      }

      // Mirrors the real RPC: compute the effect first, into a local
      // value only — nothing is written to feeAssessments or
      // financialAuditLog until both are ready to commit together.
      const updated: ServiceFeeAssessmentRow = {
        ...existing,
        state: "waived",
        reason: existing.reason ? `${existing.reason} — Waived: ${reason}` : `Waived: ${reason}`,
      };
      const auditRow: FakeFinancialAuditLogRow = {
        id: `audit-${financialAuditLog.length + 1}`,
        actorAdminUserId: audit.actorAdminUserId,
        actorRole: audit.actorRole,
        actionType: "fee_waived",
        targetEntityType: "service_fee_assessment",
        targetEntityId: existing.id,
        serviceVisitId: existing.serviceVisitId,
        reason,
        metadata: { feeType: existing.feeType, amount: existing.amount, policyVersion: existing.policyVersion },
        createdAt: new Date(),
      };

      if (financialAuditControl.simulateFailure) {
        throw new Error("[fake-scheduling] simulated financial_audit_log insert failure — no state was mutated");
      }

      feeAssessments[index] = updated;
      financialAuditLog.push(auditRow);
      return updated;
    },
    async collectServiceFeeAssessmentWithAudit(id, patch, audit) {
      const index = feeAssessments.findIndex((f) => f.id === id);
      if (index === -1) throw new InvalidVisitStateError(`service_fee_assessments ${id} not found`);
      const existing = feeAssessments[index];
      if (existing.state !== "assessed") {
        throw new InvalidVisitStateError(
          `service_fee_assessments ${id} is not eligible for collection (state=${existing.state})`
        );
      }

      const updated: ServiceFeeAssessmentRow = {
        ...existing,
        state: "paid",
        collectionMethod: patch.collectionMethod,
        externalPaymentReference: patch.externalPaymentReference,
        stripePaymentIntentId: patch.stripePaymentIntentId,
        collectedAt: new Date(),
      };
      const auditRow: FakeFinancialAuditLogRow = {
        id: `audit-${financialAuditLog.length + 1}`,
        actorAdminUserId: audit.actorAdminUserId,
        actorRole: audit.actorRole,
        actionType: "fee_collected",
        targetEntityType: "service_fee_assessment",
        targetEntityId: existing.id,
        serviceVisitId: existing.serviceVisitId,
        reason: null,
        metadata: { feeType: existing.feeType, amount: existing.amount, collectionMethod: patch.collectionMethod, externalPaymentReference: patch.externalPaymentReference },
        createdAt: new Date(),
      };

      if (financialAuditControl.simulateFailure) {
        throw new Error("[fake-scheduling] simulated financial_audit_log insert failure — no state was mutated");
      }

      feeAssessments[index] = updated;
      financialAuditLog.push(auditRow);
      return updated;
    },
    async insertServiceVisitNotification(row: NewServiceVisitNotificationRow) {
      if (notifications.has(row.idempotencyKey)) {
        return { inserted: false };
      }
      notifications.set(row.idempotencyKey, {
        id: randomUUID(),
        serviceVisitId: row.serviceVisitId,
        customerId: row.customerId,
        notificationType: row.notificationType,
        channel: row.channel,
        scheduledSendAt: row.scheduledSendAt,
        idempotencyKey: row.idempotencyKey,
        state: "pending",
        sentAt: null,
        failureReason: null,
        retryCount: 0,
        providerMessageId: null,
        claimedAt: null,
      });
      return { inserted: true };
    },
    async cancelPendingServiceVisitNotifications(serviceVisitId) {
      // Scoped to reminder_24h only — see the matching comment in
      // supabase-scheduling-repository.ts.
      for (const n of notifications.values()) {
        if (n.serviceVisitId === serviceVisitId && n.notificationType === "reminder_24h" && n.state === "pending") n.state = "cancelled";
      }
    },
    async listServiceVisitNotifications(serviceVisitId) {
      return [...notifications.values()]
        .filter((n) => n.serviceVisitId === serviceVisitId)
        .sort((a, b) => b.scheduledSendAt.getTime() - a.scheduledSendAt.getTime());
    },
    async findServiceVisitNotificationById(id) {
      for (const n of notifications.values()) {
        if (n.id === id) return n;
      }
      return null;
    },
    async claimDueServiceVisitNotifications(limit, staleMinutes) {
      const now = Date.now();
      const staleMs = staleMinutes * 60_000;
      const claimable = [...notifications.values()]
        .filter(
          (n) =>
            (n.state === "pending" && n.scheduledSendAt.getTime() <= now) ||
            (n.state === "sending" && n.claimedAt !== null && now - n.claimedAt.getTime() > staleMs)
        )
        .sort((a, b) => a.scheduledSendAt.getTime() - b.scheduledSendAt.getTime())
        .slice(0, limit);
      const claimedAt = new Date();
      for (const n of claimable) {
        n.state = "sending";
        n.claimedAt = claimedAt;
      }
      return claimable;
    },
    async markServiceVisitNotificationSent(id, providerMessageId) {
      for (const n of notifications.values()) {
        if (n.id === id && n.state === "sending") {
          n.state = "sent";
          n.sentAt = new Date();
          n.providerMessageId = providerMessageId;
          n.claimedAt = null;
        }
      }
    },
    async markServiceVisitNotificationRetry(id, params) {
      for (const n of notifications.values()) {
        if (n.id === id && n.state === "sending") {
          n.state = "pending";
          n.retryCount += 1;
          n.failureReason = params.failureReason;
          n.scheduledSendAt = params.nextScheduledSendAt;
          n.claimedAt = null;
        }
      }
    },
    async markServiceVisitNotificationFailedTerminal(id, failureReason) {
      for (const n of notifications.values()) {
        if (n.id === id && n.state === "sending") {
          n.state = "failed";
          n.retryCount += 1;
          n.failureReason = failureReason;
          n.claimedAt = null;
        }
      }
    },
    async retryFailedServiceVisitNotification(id) {
      for (const n of notifications.values()) {
        if (n.id === id && n.state === "failed") {
          n.state = "pending";
          n.retryCount = 0;
          n.scheduledSendAt = new Date();
          n.claimedAt = null;
        }
      }
    },
    async cancelPendingConsentReminderForVisit(serviceVisitId) {
      for (const n of notifications.values()) {
        if (n.serviceVisitId === serviceVisitId && n.notificationType === "consent_reminder" && n.state === "pending") n.state = "cancelled";
      }
    },
    async cancelPendingConsentRemindersForCustomer(customerId) {
      for (const n of notifications.values()) {
        if (n.customerId === customerId && n.notificationType === "consent_reminder" && n.state === "pending") n.state = "cancelled";
      }
    },
    async findMostRecentSentReviewRequestAt(customerId) {
      let mostRecent: Date | null = null;
      for (const n of notifications.values()) {
        if (n.customerId === customerId && n.notificationType === "review_request" && n.state === "sent" && n.sentAt) {
          if (!mostRecent || n.sentAt.getTime() > mostRecent.getTime()) mostRecent = n.sentAt;
        }
      }
      return mostRecent;
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
    async findActivePrepaidPackageForCustomer(customerId) {
      const candidates = [...prepaidPackagesById.values()]
        .filter((p) => p.customerId === customerId && p.status === "active" && p.remainingVisitCount > 0)
        .sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());
      return candidates[0] ?? null;
    },
    async cancelPrepaidPackageWithRefundAudit(id, patch, audit) {
      const existing = prepaidPackagesById.get(id);
      if (!existing) throw new Error(`[fake-scheduling] prepaid_packages ${id} not found`);
      if (existing.status !== "active") {
        throw new Error(`[fake-scheduling] prepaid_packages ${id} is not eligible for cancellation (status=${existing.status}, must be active)`);
      }
      if (patch.refundAmount < 0) {
        throw new Error(`[fake-scheduling] refund amount must be >= 0, got ${patch.refundAmount}`);
      }
      const packageTotalPaid = existing.packageTotalPaid ?? 0;
      if (patch.refundAmount > packageTotalPaid) {
        throw new Error(`[fake-scheduling] refund of ${patch.refundAmount} would exceed the original package principal ${packageTotalPaid} (id=${id})`);
      }

      const now = new Date();
      const updated: PrepaidPackageRow = {
        ...existing,
        status: "cancelled",
        refundedAmount: patch.refundAmount,
        refundedAt: patch.refundAmount > 0 ? now : (existing.refundedAt ?? null),
        cancelledAt: now,
        cancellationReason: patch.reason,
      };

      const auditRow: FakeFinancialAuditLogRow = {
        id: `audit-${financialAuditLog.length + 1}`,
        actorAdminUserId: audit.actorAdminUserId,
        actorRole: audit.actorRole,
        actionType: "refund_issued",
        targetEntityType: "prepaid_package",
        targetEntityId: existing.id,
        serviceVisitId: null,
        reason: patch.reason,
        metadata: {
          refundAmount: patch.refundAmount,
          stripeRefundId: patch.stripeRefundId,
          packageTotalPaid,
          purchasedVisitCount: existing.purchasedVisitCount,
          remainingVisitCountAtCancellation: existing.remainingVisitCount,
        },
        createdAt: now,
      };

      if (financialAuditControl.simulateFailure) {
        throw new Error("[fake-scheduling] simulated financial_audit_log insert failure — no state was mutated");
      }

      prepaidPackagesById.set(id, updated);
      financialAuditLog.push(auditRow);

      return updated;
    },
    async listActiveRecurringSchedulesForCustomer(customerId) {
      return [...recurringSchedulesById.values()].filter((r) => r.customerId === customerId && r.status === "active");
    },
    async listPackageVisitPlans(prepaidPackageId) {
      return [...packageVisitPlansById.values()]
        .filter((p) => p.prepaidPackageId === prepaidPackageId)
        .sort((a, b) => a.visitNumber - b.visitNumber);
    },
    async findPackageVisitPlanById(id) {
      return packageVisitPlansById.get(id) ?? null;
    },
    async findPackageVisitPlanByRecurringVisitPlanId(recurringVisitPlanId) {
      for (const p of packageVisitPlansById.values()) {
        if (p.recurringVisitPlanId === recurringVisitPlanId) return p;
      }
      return null;
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
        recurringVisitPlanId: null,
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
        recurringVisitPlanId: patch.recurringVisitPlanId ?? existing.recurringVisitPlanId,
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

    async listRecurringVisitPlans(recurringScheduleId) {
      return [...recurringVisitPlansById.values()]
        .filter((p) => p.recurringScheduleId === recurringScheduleId)
        .sort((a, b) => a.visitNumber - b.visitNumber);
    },
    async findRecurringVisitPlanById(id) {
      return recurringVisitPlansById.get(id) ?? null;
    },
    async findRecurringVisitPlanByServiceVisitId(serviceVisitId) {
      for (const p of recurringVisitPlansById.values()) {
        if (p.serviceVisitId === serviceVisitId) return p;
      }
      return null;
    },
    async insertRecurringVisitPlan(row: NewRecurringVisitPlanRow) {
      const existing = [...recurringVisitPlansById.values()].find(
        (p) => p.recurringScheduleId === row.recurringScheduleId && p.visitNumber === row.visitNumber
      );
      if (existing) {
        return { plan: existing, inserted: false };
      }
      const id = randomUUID();
      const created: RecurringVisitPlanRow = {
        id,
        recurringScheduleId: row.recurringScheduleId,
        customerId: row.customerId,
        visitNumber: row.visitNumber,
        plannedDate: row.plannedDate,
        plannedStartTime: row.plannedStartTime,
        status: "planned",
        serviceVisitId: null,
      };
      recurringVisitPlansById.set(id, created);
      return { plan: created, inserted: true };
    },
    async updateRecurringVisitPlan(id, patch) {
      const existing = recurringVisitPlansById.get(id);
      if (!existing) return;
      recurringVisitPlansById.set(id, {
        ...existing,
        plannedDate: patch.plannedDate ?? existing.plannedDate,
        plannedStartTime: patch.plannedStartTime ?? existing.plannedStartTime,
        status: patch.status ?? existing.status,
        serviceVisitId: patch.serviceVisitId ?? existing.serviceVisitId,
        recurringScheduleId: patch.recurringScheduleId ?? existing.recurringScheduleId,
      });
    },
    async insertRecurringVisitPlanHistory(row) {
      recurringVisitPlanHistory.push(row);
    },

    async findActiveRecurringScopeVersion(recurringScheduleId) {
      for (const v of recurringScopeVersionsById.values()) {
        if (v.recurringScheduleId === recurringScheduleId && v.status === "active") return v;
      }
      return null;
    },
    async findRecurringScopeVersionById(id) {
      return recurringScopeVersionsById.get(id) ?? null;
    },
    async insertRecurringScopeVersion(row: NewRecurringScopeVersionRow) {
      const id = randomUUID();
      const created: RecurringScopeVersionRow = { id, status: "pending_customer_approval", ...row };
      recurringScopeVersionsById.set(id, created);
      return created;
    },
    async supersedeRecurringScopeVersion(id) {
      const existing = recurringScopeVersionsById.get(id);
      if (existing) recurringScopeVersionsById.set(id, { ...existing, status: "superseded" });
    },
    async updateRecurringScopeVersionStatus(id, status) {
      const existing = recurringScopeVersionsById.get(id);
      if (!existing) return null;
      const updated = { ...existing, status };
      recurringScopeVersionsById.set(id, updated);
      return updated;
    },

    async findServiceVisitPricingByVisitId(serviceVisitId) {
      return servicePricingByVisitId.get(serviceVisitId) ?? null;
    },
    async upsertServiceVisitPricing(row: NewServiceVisitPricingRow) {
      const existing = servicePricingByVisitId.get(row.serviceVisitId);
      const updated: ServiceVisitPricingRow = {
        id: existing?.id ?? randomUUID(),
        serviceVisitId: row.serviceVisitId,
        pricingVersion: row.pricingVersion,
        pricingSnapshot: row.pricingSnapshot,
        baseAmount: row.baseAmount,
        addOnIds: row.addOnIds,
        addOnAmount: row.addOnAmount,
        totalAmount: row.totalAmount,
        amountDueFromCustomer: row.amountDueFromCustomer,
        priceStatus: row.priceStatus,
        requiresCustomerApproval: row.requiresCustomerApproval,
        previouslyApprovedAmount: row.previouslyApprovedAmount,
        paymentStatus: existing?.paymentStatus ?? "not_applicable",
        confirmedAt: existing?.confirmedAt ?? null,
        confirmedBy: existing?.confirmedBy ?? null,
      };
      servicePricingByVisitId.set(row.serviceVisitId, updated);
      return updated;
    },
    async confirmServiceVisitPricing(serviceVisitId, confirmedBy) {
      const existing = servicePricingByVisitId.get(serviceVisitId);
      if (!existing) return null;
      const updated: ServiceVisitPricingRow = {
        ...existing,
        priceStatus: "confirmed",
        previouslyApprovedAmount: existing.totalAmount,
        requiresCustomerApproval: false,
        paymentStatus: existing.amountDueFromCustomer > 0 ? "awaiting_completion" : "not_applicable",
        confirmedAt: new Date(),
        confirmedBy,
      };
      servicePricingByVisitId.set(serviceVisitId, updated);
      return updated;
    },
    async updateServiceVisitPricingPaymentStatus(serviceVisitId, paymentStatus) {
      const existing = servicePricingByVisitId.get(serviceVisitId);
      if (!existing) return null;
      const updated = { ...existing, paymentStatus };
      servicePricingByVisitId.set(serviceVisitId, updated);
      return updated;
    },

    async findServiceVisitPaymentByVisitId(serviceVisitId) {
      return paymentsByVisitId.get(serviceVisitId) ?? null;
    },
    async findServiceVisitPaymentById(id) {
      for (const record of paymentsByVisitId.values()) if (record.id === id) return record;
      return null;
    },
    async findServiceVisitPaymentByStripePaymentIntentId(stripePaymentIntentId) {
      for (const record of paymentsByVisitId.values()) if (record.stripePaymentIntentId === stripePaymentIntentId) return record;
      return null;
    },
    async insertServiceVisitPaymentAttempt(row: NewServiceVisitPaymentRow) {
      const existing = paymentsByVisitId.get(row.serviceVisitId);
      if (existing) return { inserted: false, record: existing };

      const created: ServiceVisitPaymentRow = {
        id: randomUUID(),
        serviceVisitId: row.serviceVisitId,
        serviceVisitPricingId: row.serviceVisitPricingId,
        approvedAmount: row.approvedAmount,
        tipBasisAmount: null,
        tipSelectionType: null,
        tipPercentage: null,
        tipAmount: null,
        taxAmount: null,
        totalAmount: null,
        tipSelectedAt: null,
        tipConfirmedAt: null,
        taxLocationSnapshot: null,
        currency: "usd",
        paymentMethodType: null,
        stripeCustomerId: null,
        stripePaymentMethodId: null,
        cardBrand: null,
        cardLast4: null,
        stripePaymentIntentId: null,
        stripeTaxCalculationId: null,
        taxCalculationExpiresAt: null,
        taxTransactionStatus: "not_applicable",
        stripeTaxTransactionId: null,
        taxTransactionFailureCode: null,
        taxTransactionFailureMessage: null,
        taxTransactionLastAttemptAt: null,
        externalPaymentReference: null,
        status: "created",
        idempotencyKey: row.idempotencyKey,
        failureCode: null,
        failureMessage: null,
        refundedAmount: 0,
        refundedAt: null,
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      paymentsByVisitId.set(row.serviceVisitId, created);
      return { inserted: true, record: created };
    },
    async updateServiceVisitPaymentTip(id: string, patch: ServiceVisitPaymentTipPatch) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) throw new Error(`[fake-scheduling] service_visit_payments ${id} not found`);
      if (existing.tipConfirmedAt) throw new Error(`[fake-scheduling] service_visit_payments ${id} is already frozen (tip_confirmed_at is set) — cannot update tip`);
      const updated: ServiceVisitPaymentRow = {
        ...existing,
        tipBasisAmount: patch.tipBasisAmount,
        tipSelectionType: patch.tipSelectionType,
        tipPercentage: patch.tipPercentage,
        tipAmount: patch.tipAmount,
        taxAmount: patch.taxAmount,
        totalAmount: patch.totalAmount,
        stripeTaxCalculationId: patch.stripeTaxCalculationId,
        taxCalculationExpiresAt: patch.taxCalculationExpiresAt,
        taxLocationSnapshot: patch.taxLocationSnapshot,
        tipSelectedAt: new Date(),
      };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },
    async freezeServiceVisitPaymentForStripeCard(id: string, patch: ServiceVisitPaymentStripeCardFreezePatch) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) throw new Error(`[fake-scheduling] service_visit_payments ${id} not found`);
      if (existing.tipConfirmedAt) throw new Error(`[fake-scheduling] service_visit_payments ${id} is already frozen — cannot freeze again`);
      const updated: ServiceVisitPaymentRow = {
        ...existing,
        paymentMethodType: "stripe_card",
        stripeCustomerId: patch.stripeCustomerId,
        stripePaymentMethodId: patch.stripePaymentMethodId,
        cardBrand: patch.cardBrand,
        cardLast4: patch.cardLast4,
        tipConfirmedAt: new Date(),
      };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },
    async freezeServiceVisitPaymentAsNoPaymentDue(id: string) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) throw new Error(`[fake-scheduling] service_visit_payments ${id} not found`);
      if (existing.tipConfirmedAt) throw new Error(`[fake-scheduling] service_visit_payments ${id} is already frozen — cannot freeze again`);
      const updated: ServiceVisitPaymentRow = { ...existing, status: "no_payment_due", tipConfirmedAt: new Date() };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },
    async setServiceVisitPaymentIntent(id: string, params: { stripePaymentIntentId: string; status: ServiceVisitPaymentRow["status"] }) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) throw new Error(`[fake-scheduling] service_visit_payments ${id} not found`);
      if (existing.stripePaymentIntentId) throw new Error(`[fake-scheduling] service_visit_payments ${id} already has a stripe_payment_intent_id`);
      const updated: ServiceVisitPaymentRow = { ...existing, stripePaymentIntentId: params.stripePaymentIntentId, status: params.status };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },
    async updateServiceVisitPaymentStatus(id: string, patch, allowedFromStatuses) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) return null;
      if (!(allowedFromStatuses as readonly string[]).includes(existing.status)) return null;
      const updated: ServiceVisitPaymentRow = {
        ...existing,
        status: patch.status,
        failureCode: patch.failureCode !== undefined ? patch.failureCode : existing.failureCode,
        failureMessage: patch.failureMessage !== undefined ? patch.failureMessage : existing.failureMessage,
        paidAt: patch.paidAt !== undefined ? patch.paidAt : existing.paidAt,
      };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },
    async recordExternalServiceVisitPaymentWithAudit(
      id: string,
      patch: ServiceVisitPaymentExternalSettlementPatch,
      audit: { actorAdminUserId: string; actorRole: string }
    ) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) throw new Error(`[fake-scheduling] service_visit_payments ${id} not found`);
      if (existing.status !== "created") throw new Error(`[fake-scheduling] service_visit_payments ${id} is not eligible for external settlement (must be status='created')`);

      // Mirrors the real RPC: compute every effect first, into local
      // values only — nothing is written to paymentsByVisitId,
      // servicePricingByVisitId, or financialAuditLog until every step has
      // succeeded. If financialAuditControl.simulateFailure is set (a test
      // simulating the audit half of the real transaction failing), throw
      // here, BEFORE any commit — proving the same all-or-nothing guarantee
      // a real Postgres transaction rollback would give.
      const now = new Date();
      const updatedPayment: ServiceVisitPaymentRow = {
        ...existing,
        paymentMethodType: patch.paymentMethodType,
        externalPaymentReference: patch.externalPaymentReference,
        status: "paid",
        paidAt: now,
        taxTransactionStatus: "pending",
        tipConfirmedAt: existing.tipConfirmedAt ?? now,
      };

      const existingPricing = servicePricingByVisitId.get(existing.serviceVisitId);
      const updatedPricing: ServiceVisitPricingRow | null = existingPricing
        ? { ...existingPricing, paymentStatus: "paid" }
        : null;

      const auditRow: FakeFinancialAuditLogRow = {
        id: `audit-${financialAuditLog.length + 1}`,
        actorAdminUserId: audit.actorAdminUserId,
        actorRole: audit.actorRole,
        actionType: "external_payment_recorded",
        targetEntityType: "service_visit_payment",
        targetEntityId: existing.id,
        serviceVisitId: existing.serviceVisitId,
        reason: patch.externalPaymentReference,
        metadata: { paymentMethodType: patch.paymentMethodType, totalAmount: existing.totalAmount },
        createdAt: now,
      };

      if (financialAuditControl.simulateFailure) {
        throw new Error("[fake-scheduling] simulated financial_audit_log insert failure — no state was mutated");
      }

      paymentsByVisitId.set(existing.serviceVisitId, updatedPayment);
      if (updatedPricing) servicePricingByVisitId.set(existing.serviceVisitId, updatedPricing);
      financialAuditLog.push(auditRow);

      return updatedPayment;
    },
    async refundServiceVisitPaymentWithAudit(id, patch, audit) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) throw new Error(`[fake-scheduling] service_visit_payments ${id} not found`);
      if (existing.status !== "paid" && existing.status !== "partially_refunded") {
        throw new Error(`[fake-scheduling] service_visit_payments ${id} is not eligible for refund (status=${existing.status}, must be paid or partially_refunded)`);
      }
      if (patch.refundAmount <= 0) {
        throw new Error(`[fake-scheduling] refund amount must be positive, got ${patch.refundAmount}`);
      }

      const existingRefundedAmount = existing.refundedAmount ?? 0;
      const newRefundedAmount = existingRefundedAmount + patch.refundAmount;
      const totalAmount = existing.totalAmount ?? 0;
      if (newRefundedAmount > totalAmount) {
        throw new Error(
          `[fake-scheduling] refund of ${patch.refundAmount} would exceed the remaining refundable balance (already refunded ${existingRefundedAmount}, total ${totalAmount})`
        );
      }

      // Mirrors the real RPC: compute every effect first; nothing is
      // written until every step has succeeded (same all-or-nothing
      // guarantee as recordExternalServiceVisitPaymentWithAudit above).
      const now = new Date();
      const newStatus: ServiceVisitPaymentRow["status"] = newRefundedAmount >= totalAmount ? "refunded" : "partially_refunded";
      const updatedPayment: ServiceVisitPaymentRow = {
        ...existing,
        refundedAmount: newRefundedAmount,
        refundedAt: now,
        status: newStatus,
      };

      const existingPricing = servicePricingByVisitId.get(existing.serviceVisitId);
      const updatedPricing: ServiceVisitPricingRow | null = existingPricing ? { ...existingPricing, paymentStatus: newStatus } : null;

      const auditRow: FakeFinancialAuditLogRow = {
        id: `audit-${financialAuditLog.length + 1}`,
        actorAdminUserId: audit.actorAdminUserId,
        actorRole: audit.actorRole,
        actionType: "refund_issued",
        targetEntityType: "service_visit_payment",
        targetEntityId: existing.id,
        serviceVisitId: existing.serviceVisitId,
        reason: patch.reason,
        metadata: { refundAmount: patch.refundAmount, stripeRefundId: patch.stripeRefundId, newStatus, totalRefundedAmount: newRefundedAmount },
        createdAt: now,
      };

      if (financialAuditControl.simulateFailure) {
        throw new Error("[fake-scheduling] simulated financial_audit_log insert failure — no state was mutated");
      }

      paymentsByVisitId.set(existing.serviceVisitId, updatedPayment);
      if (updatedPricing) servicePricingByVisitId.set(existing.serviceVisitId, updatedPricing);
      financialAuditLog.push(auditRow);

      return updatedPayment;
    },
    async updateServiceVisitPaymentTaxSync(id: string, patch: ServiceVisitPaymentTaxSyncPatch) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) return null;
      const updated: ServiceVisitPaymentRow = {
        ...existing,
        taxTransactionStatus: patch.taxTransactionStatus,
        stripeTaxTransactionId: patch.stripeTaxTransactionId !== undefined ? patch.stripeTaxTransactionId : existing.stripeTaxTransactionId,
        stripeTaxCalculationId: patch.stripeTaxCalculationId !== undefined ? patch.stripeTaxCalculationId : existing.stripeTaxCalculationId,
        taxCalculationExpiresAt: patch.taxCalculationExpiresAt !== undefined ? patch.taxCalculationExpiresAt : existing.taxCalculationExpiresAt,
        taxTransactionFailureCode: patch.taxTransactionFailureCode !== undefined ? patch.taxTransactionFailureCode : existing.taxTransactionFailureCode,
        taxTransactionFailureMessage: patch.taxTransactionFailureMessage !== undefined ? patch.taxTransactionFailureMessage : existing.taxTransactionFailureMessage,
        taxTransactionLastAttemptAt: new Date(),
      };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },
    async updateServiceVisitPaymentRefund(id: string, patch: { refundedAmount: number; refundedAt: Date; status: "partially_refunded" | "refunded" }, allowedFromStatuses) {
      const existing = [...paymentsByVisitId.values()].find((r) => r.id === id);
      if (!existing) return null;
      if (!(allowedFromStatuses as readonly string[]).includes(existing.status)) return null;
      const updated: ServiceVisitPaymentRow = { ...existing, refundedAmount: patch.refundedAmount, refundedAt: patch.refundedAt, status: patch.status };
      paymentsByVisitId.set(existing.serviceVisitId, updated);
      return updated;
    },

    async createTaxReversalReconciliation(input) {
      if (input.intendedAmount <= 0) {
        throw new Error(`[fake-scheduling] create_tax_reversal_reconciliation: p_intended_amount must be positive, got ${input.intendedAmount}`);
      }
      const row: TaxReversalReconciliationRow = {
        id: randomUUID(),
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        originalTransactionId: input.originalTransactionId,
        intendedAmount: input.intendedAmount,
        mode: input.mode,
        status: "pending",
        stripeReversalId: null,
        failureMessage: null,
        retryCount: 0,
        createdAt: new Date(),
        lastAttemptedAt: null,
        succeededAt: null,
      };
      taxReversalReconciliationsById.set(row.id, row);
      return row;
    },

    async findTaxReversalReconciliationById(id) {
      return taxReversalReconciliationsById.get(id) ?? null;
    },

    async listTaxReversalReconciliationsForTarget(targetEntityType, targetEntityId) {
      return [...taxReversalReconciliationsById.values()]
        .filter((r) => r.targetEntityType === targetEntityType && r.targetEntityId === targetEntityId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    async markTaxReversalReconciliationSucceeded(id, stripeReversalId, audit) {
      const existing = taxReversalReconciliationsById.get(id);
      if (!existing) throw new Error(`[fake-scheduling] tax_reversal_reconciliations ${id} not found`);
      if (existing.status === "succeeded") return existing; // idempotent no-op — mirrors the real RPC, no second audit row.

      const now = new Date();
      const updated: TaxReversalReconciliationRow = {
        ...existing,
        status: "succeeded",
        stripeReversalId,
        succeededAt: now,
        lastAttemptedAt: now,
      };

      const auditRow: FakeFinancialAuditLogRow = {
        id: `audit-${financialAuditLog.length + 1}`,
        actorAdminUserId: audit.actorAdminUserId,
        actorRole: audit.actorRole,
        actionType: "tax_reversal_reconciled",
        targetEntityType: "tax_reversal_reconciliation",
        targetEntityId: existing.id,
        serviceVisitId: existing.targetEntityType === "service_visit_payment" ? ([...paymentsByVisitId.values()].find((p) => p.id === existing.targetEntityId)?.serviceVisitId ?? null) : null,
        reason: null,
        metadata: {
          outcome: "succeeded",
          targetEntityType: existing.targetEntityType,
          targetEntityId: existing.targetEntityId,
          originalTransactionId: existing.originalTransactionId,
          intendedAmount: existing.intendedAmount,
          mode: existing.mode,
          stripeReversalId,
          retryCount: existing.retryCount,
        },
        createdAt: now,
      };

      taxReversalReconciliationsById.set(id, updated);
      financialAuditLog.push(auditRow);
      return updated;
    },

    async markTaxReversalReconciliationFailed(id, failureMessage) {
      const existing = taxReversalReconciliationsById.get(id);
      if (!existing) throw new Error(`[fake-scheduling] tax_reversal_reconciliations ${id} not found`);
      if (existing.status === "succeeded") {
        throw new Error(`[fake-scheduling] tax_reversal_reconciliations ${id} has already succeeded — cannot mark a succeeded reversal as failed`);
      }
      const updated: TaxReversalReconciliationRow = {
        ...existing,
        status: "failed",
        failureMessage,
        retryCount: existing.retryCount + 1,
        lastAttemptedAt: new Date(),
      };
      taxReversalReconciliationsById.set(id, updated);
      return updated;
    },

    async upsertStripeDisputeEvent(input) {
      const existing = stripeDisputesByStripeDisputeId.get(input.stripeDisputeId);
      const payment = input.stripePaymentIntentId ? [...paymentsByVisitId.values()].find((p) => p.stripePaymentIntentId === input.stripePaymentIntentId) : undefined;
      const serviceVisitPaymentId = payment?.id ?? null;
      const serviceVisitId = payment?.serviceVisitId ?? null;

      if (existing) {
        // Mirrors the real RPC's causal/monotonic guard exactly: a stale,
        // duplicate, or out-of-order delivery (by the event's own created
        // timestamp) is a safe no-op that returns the unchanged row.
        if (existing.lastStripeEventCreatedAt.getTime() >= input.stripeEventCreatedAt.getTime()) {
          return existing;
        }
        const updated: StripeDisputeRow = {
          ...existing,
          stripeChargeId: input.stripeChargeId,
          stripePaymentIntentId: input.stripePaymentIntentId,
          serviceVisitPaymentId,
          serviceVisitId,
          amount: input.amount,
          currency: input.currency,
          disputeStatus: input.disputeStatus,
          reason: input.reason,
          lastStripeEventId: input.stripeEventId,
          lastStripeEventCreatedAt: input.stripeEventCreatedAt,
          closedAt: input.isClosed ? (existing.closedAt ?? new Date()) : existing.closedAt,
          updatedAt: new Date(),
        };
        stripeDisputesByStripeDisputeId.set(input.stripeDisputeId, updated);
        return updated;
      }

      const created: StripeDisputeRow = {
        id: randomUUID(),
        stripeDisputeId: input.stripeDisputeId,
        stripeChargeId: input.stripeChargeId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        serviceVisitPaymentId,
        serviceVisitId,
        amount: input.amount,
        currency: input.currency,
        disputeStatus: input.disputeStatus,
        reason: input.reason,
        stripeCreatedAt: input.stripeCreatedAt,
        lastStripeEventId: input.stripeEventId,
        lastStripeEventCreatedAt: input.stripeEventCreatedAt,
        closedAt: input.isClosed ? new Date() : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      stripeDisputesByStripeDisputeId.set(input.stripeDisputeId, created);
      return created;
    },
  };

  return {
    repo,
    state: {
      paymentsByVisitId,
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
      recurringVisitPlansById,
      recurringVisitPlanHistory,
      recurringScopeVersionsById,
      servicePricingByVisitId,
      taxReversalReconciliationsById,
      stripeDisputesByStripeDisputeId,
      financialAuditLog,
      financialAuditControl,
    },
  };
}
