import type { SchedulingRepository } from "@/lib/scheduling/repository";

/** Thrown whenever a portal action's target resource does not belong to the authenticated customer — never trust a client-supplied id alone. */
export class CustomerOwnershipError extends Error {
  constructor(message = "This item doesn't belong to your account.") {
    super(message);
    this.name = "CustomerOwnershipError";
  }
}

export async function assertVisitBelongsToCustomer(repo: SchedulingRepository, serviceVisitId: string, customerId: string) {
  const visit = await repo.findServiceVisitById(serviceVisitId);
  if (!visit || visit.customerId !== customerId) {
    throw new CustomerOwnershipError();
  }
  return visit;
}

export async function assertRecurringVisitPlanBelongsToCustomer(repo: SchedulingRepository, recurringVisitPlanId: string, customerId: string) {
  const plan = await repo.findRecurringVisitPlanById(recurringVisitPlanId);
  if (!plan || plan.customerId !== customerId) {
    throw new CustomerOwnershipError();
  }
  return plan;
}

export async function assertRecurringScheduleBelongsToCustomer(repo: SchedulingRepository, recurringScheduleId: string, customerId: string) {
  const schedule = await repo.findRecurringScheduleById(recurringScheduleId);
  if (!schedule || schedule.customerId !== customerId) {
    throw new CustomerOwnershipError();
  }
  return schedule;
}

export async function assertPrepaidPackageBelongsToCustomer(repo: SchedulingRepository, prepaidPackageId: string, customerId: string) {
  const pkg = await repo.findPrepaidPackageById(prepaidPackageId);
  if (!pkg || pkg.customerId !== customerId) {
    throw new CustomerOwnershipError();
  }
  return pkg;
}

export async function assertRecurringScopeVersionBelongsToCustomer(repo: SchedulingRepository, recurringScopeVersionId: string, customerId: string) {
  const version = await repo.findRecurringScopeVersionById(recurringScopeVersionId);
  if (!version || version.customerId !== customerId) {
    throw new CustomerOwnershipError();
  }
  return version;
}

export async function assertPackageAmendmentBelongsToCustomer(repo: SchedulingRepository, packageAmendmentId: string, customerId: string) {
  const amendment = await repo.findPackageAmendmentById(packageAmendmentId);
  if (!amendment) {
    throw new CustomerOwnershipError();
  }
  await assertPrepaidPackageBelongsToCustomer(repo, amendment.prepaidPackageId, customerId);
  return amendment;
}
