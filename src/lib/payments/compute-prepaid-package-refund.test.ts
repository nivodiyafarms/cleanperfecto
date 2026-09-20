import { describe, expect, it } from "vitest";
import { computePrepaidPackageRefund } from "./compute-prepaid-package-refund";

describe("computePrepaidPackageRefund — shared refund preview/execution formula", () => {
  // The real sandbox package: $770.63 principal, $63.58 tax, 6 purchased.
  const BASE = { packageTotalPaid: 770.63, taxAmount: 63.58, purchasedVisitCount: 6 };

  it.each([
    [0, 0, 0],
    [1, 128.44, 10.6],
    [2, 256.88, 21.19],
    [3, 385.32, 31.79],
    [4, 513.75, 42.39],
    [5, 642.19, 52.98],
    [6, 770.63, 63.58],
  ])("remaining=%i of 6 -> principal $%d, tax $%d", (remaining, expectedPrincipal, expectedTax) => {
    const result = computePrepaidPackageRefund({ ...BASE, remainingVisitCount: remaining });
    expect(result.refundAmount).toBe(expectedPrincipal);
    expect(result.refundTaxAmount).toBe(expectedTax);
  });

  it("a null taxAmount (legacy package or TAX_MODE disabled at purchase) refunds $0 tax, never an invented figure", () => {
    const result = computePrepaidPackageRefund({ packageTotalPaid: 900, taxAmount: null, remainingVisitCount: 4, purchasedVisitCount: 6 });
    expect(result.refundAmount).toBe(600);
    expect(result.refundTaxAmount).toBe(0);
  });

  it("rounds once, at the end — a non-evenly-divisible fraction never accumulates intermediate error", () => {
    // $1000 / 6 * 5 = 833.33333... -> must round to exactly 833.33.
    const result = computePrepaidPackageRefund({ packageTotalPaid: 1000, taxAmount: null, remainingVisitCount: 5, purchasedVisitCount: 6 });
    expect(result.refundAmount).toBe(833.33);
  });
});
