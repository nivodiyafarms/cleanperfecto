import "server-only";

import { roundToCents } from "@/lib/pricing/money";
import { applyAchIncentive } from "./ach-incentive";
import type { BookingPricingOptions, PrepaidFrequency } from "./types";

const PACKAGE_FREQUENCIES: PrepaidFrequency[] = ["weekly", "biweekly", "every_4_weeks"];

export interface AchPackagePricing {
  achSubtotal: number;
  achSavingsAmount: number;
  achEffectivePricePerVisit: number;
}

/**
 * Server-authoritative ACH display pricing for every prepaid package
 * option, computed once per page render from the already-trusted
 * (10%-discounted) card `prepaidPackageTotal` — never recomputed or
 * invented in the client. The booking page passes this down as props so
 * the "Bank Account (ACH)" toggle can show the exact server-calculated
 * ACH amount instantly, with no React-side pricing math. Null for a
 * frequency that isn't buyable (manual review) — there is no card
 * subtotal to discount.
 */
export function buildAchPackageOptions(
  packages: BookingPricingOptions["packages"]
): Record<PrepaidFrequency, AchPackagePricing | null> {
  const result = {} as Record<PrepaidFrequency, AchPackagePricing | null>;
  for (const frequency of PACKAGE_FREQUENCIES) {
    const pkg = packages[frequency];
    if (pkg.prepaidPackageTotal === null) {
      result[frequency] = null;
      continue;
    }
    const { achSubtotal, achSavingsAmount } = applyAchIncentive(pkg.prepaidPackageTotal);
    result[frequency] = {
      achSubtotal,
      achSavingsAmount,
      achEffectivePricePerVisit: roundToCents(achSubtotal / pkg.visitCount),
    };
  }
  return result;
}
