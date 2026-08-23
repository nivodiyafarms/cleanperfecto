import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import { roundToCents } from "@/lib/pricing/money";
import type { CalculationInput } from "@/lib/pricing/types";
import type { PackageAmendmentRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import type { RecurringCadence } from "./types";

export interface CreatePackageAmendmentInput {
  prepaidPackageId: string;
  newCadence: RecurringCadence;
  effectiveFromVisitNumber: number;
  /** The original quote's frozen base scope (property/rooms/condition/zip, etc.) — reused, never re-collected, so repricing goes through the exact same server-authoritative engine as the original purchase. */
  baseInput: CalculationInput;
  now: Date;
  reason?: string;
  initiatedByNote?: string;
}

/**
 * Prices a proposed cadence change for a prepaid package's REMAINING/
 * unused visits only, using the existing server-authoritative
 * calculateEstimate() — never a duplicated or invented pricing formula.
 * The "old" value is the package's actual historical per-visit price
 * already charged (prepaid_packages.effective_price_per_visit x remaining
 * count) — never re-derived from the engine, which could drift from what
 * was truly paid if pricing config changed since purchase. The "new" value
 * is a fresh engine calculation at the new cadence. Creates the amendment
 * in pending_customer_approval — see apply-package-amendment.ts for what
 * happens once it's approved (and, for an increase, paid).
 */
export async function createPackageAmendment(
  repo: SchedulingRepository,
  input: CreatePackageAmendmentInput
): Promise<PackageAmendmentRow> {
  const pkg = await repo.findPrepaidPackageById(input.prepaidPackageId);
  if (!pkg) {
    throw new InvalidVisitStateError(`prepaid_package ${input.prepaidPackageId} not found`);
  }
  if (pkg.status !== "active") {
    throw new InvalidVisitStateError(`prepaid_package ${input.prepaidPackageId} is not active (status=${pkg.status})`);
  }

  const remainingVisitCount = pkg.remainingVisitCount;
  const oldRemainingValue = roundToCents(pkg.effectivePricePerVisit * remainingVisitCount);

  // Reprice at the package's own ORIGINAL purchasedVisitCount (never
  // remainingVisitCount) — the 6+-package discount qualification is a
  // property of the package itself, established at purchase, not of how
  // many visits happen to be left. Using remainingVisitCount here would
  // silently fall outside the engine's own isPrepaidPackage && visitCount
  // >= PACKAGE_MIN_VISITS gate once a package drops below 6 remaining
  // visits, incorrectly losing package pricing entirely. The resulting
  // effectivePricePerVisit is what actually varies with cadence; it's then
  // multiplied by the TRUE remaining count for the amendment's dollar value.
  const calculationInput: CalculationInput = {
    ...input.baseInput,
    frequency: input.newCadence,
    isPrepaidPackage: true,
    visitCount: pkg.purchasedVisitCount,
    addOnIds: [],
    visitAddOns: undefined,
    firstCleaningEligible: false,
    asOf: input.now,
  };
  const result = calculateEstimate(calculationInput);

  if (result.manualReviewRequired || result.effectivePricePerVisit === null) {
    throw new InvalidVisitStateError(
      `Cannot compute an instant repricing for prepaid_package ${input.prepaidPackageId} at the new cadence — manual pricing review required.`
    );
  }

  const newRemainingValue = roundToCents(result.effectivePricePerVisit * remainingVisitCount);
  const valueDifference = roundToCents(newRemainingValue - oldRemainingValue);

  return repo.insertPackageAmendment({
    prepaidPackageId: input.prepaidPackageId,
    oldCadence: pkg.frequency,
    newCadence: input.newCadence,
    effectiveFromVisitNumber: input.effectiveFromVisitNumber,
    remainingVisitCountAtAmendment: remainingVisitCount,
    oldRemainingValue,
    newRemainingValue,
    valueDifference,
    pricingSnapshot: { input: calculationInput, result },
    reason: input.reason ?? null,
    initiatedByNote: input.initiatedByNote ?? null,
  });
}
