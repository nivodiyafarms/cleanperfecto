import { InvalidVisitStateError } from "./errors";
import { replanPackageCadence } from "./replan-package-cadence";
import type { SchedulingRepository } from "./repository";
import type { CalendarDate, TimeOfDay } from "./types";

export interface ApplyPackageAmendmentInput {
  packageAmendmentId: string;
  newFirstDate: CalendarDate;
  newFirstStartTime: TimeOfDay;
}

/**
 * Applies an approved package_amendments row to the package's actual
 * remaining planned visits, via replan-package-cadence.ts — never applied
 * until the financial gate clears: a price INCREASE (valueDifference > 0)
 * requires approvalState='approved' AND paymentState=
 * 'additional_payment_completed'; a price DECREASE (valueDifference < 0)
 * or no change only requires approvalState='approved' (the refund/credit
 * itself is tracked via paymentState, settled outside this function — no
 * automated refund charging exists in this milestone). Never silently
 * charges more or shrinks the original package total — see
 * package_amendments' own migration comment.
 */
export async function applyPackageAmendment(repo: SchedulingRepository, input: ApplyPackageAmendmentInput) {
  const amendment = await repo.findPackageAmendmentById(input.packageAmendmentId);
  if (!amendment) {
    throw new InvalidVisitStateError(`package_amendment ${input.packageAmendmentId} not found`);
  }
  if (amendment.approvalState !== "approved") {
    throw new InvalidVisitStateError(
      `package_amendment ${input.packageAmendmentId} is not approved (approvalState=${amendment.approvalState})`
    );
  }
  if (amendment.valueDifference > 0 && amendment.paymentState !== "additional_payment_completed") {
    throw new InvalidVisitStateError(
      `package_amendment ${input.packageAmendmentId} requires additional payment before it can take effect (paymentState=${amendment.paymentState})`
    );
  }

  return replanPackageCadence(repo, {
    prepaidPackageId: amendment.prepaidPackageId,
    effectiveFromVisitNumber: amendment.effectiveFromVisitNumber,
    newCadence: amendment.newCadence,
    newFirstDate: input.newFirstDate,
    newFirstStartTime: input.newFirstStartTime,
    packageAmendmentId: amendment.id,
  });
}
