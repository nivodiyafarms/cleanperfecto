import { describe, expect, it } from "vitest";
import type { TaxReversalReconciliationRow } from "@/lib/scheduling/domain-types";
import { computeVisitTaxReversalStatus } from "./visit-tax-reversal-status";

function makeReconciliation(overrides: Partial<TaxReversalReconciliationRow> = {}): TaxReversalReconciliationRow {
  return {
    id: "recon-1",
    targetEntityType: "service_visit_payment",
    targetEntityId: "payment-1",
    originalTransactionId: "txn_original",
    intendedAmount: 42.5,
    mode: "full",
    status: "pending",
    stripeReversalId: null,
    failureMessage: null,
    retryCount: 0,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    lastAttemptedAt: null,
    succeededAt: null,
    ...overrides,
  };
}

describe("computeVisitTaxReversalStatus — admin visit-detail Tax reconciliation visibility rule", () => {
  it("a failed reconciliation renders as needing attention (the warning block)", () => {
    const result = computeVisitTaxReversalStatus([makeReconciliation({ status: "failed", failureMessage: "Stripe Tax outage" })]);
    expect(result.pendingTaxReversals).toHaveLength(1);
    expect(result.pendingTaxReversals[0].status).toBe("failed");
    expect(result.hasSucceededTaxReversal).toBe(false);
  });

  it("a pending (never-yet-attempted) reconciliation also renders as needing attention", () => {
    const result = computeVisitTaxReversalStatus([makeReconciliation({ status: "pending" })]);
    expect(result.pendingTaxReversals).toHaveLength(1);
    expect(result.hasSucceededTaxReversal).toBe(false);
  });

  it("a successful reconciliation hides the retry control and shows only the compact reconciled status", () => {
    const result = computeVisitTaxReversalStatus([makeReconciliation({ status: "succeeded", stripeReversalId: "txn_reversal_1" })]);
    expect(result.pendingTaxReversals).toHaveLength(0);
    expect(result.hasSucceededTaxReversal).toBe(true);
  });

  it("no reconciliation at all (normal paid visit, external cash/Zelle payment, or a prepaid-package Checkout refund which never creates one) renders nothing", () => {
    const result = computeVisitTaxReversalStatus([]);
    expect(result.pendingTaxReversals).toHaveLength(0);
    expect(result.hasSucceededTaxReversal).toBe(false);
  });

  it("multiple independent refund events: a later failed reversal still shows a warning even though an earlier one on the same payment succeeded", () => {
    const result = computeVisitTaxReversalStatus([
      makeReconciliation({ id: "recon-1", status: "succeeded", intendedAmount: 30 }),
      makeReconciliation({ id: "recon-2", status: "failed", intendedAmount: 12.5, failureMessage: "still down" }),
    ]);
    expect(result.pendingTaxReversals).toHaveLength(1);
    expect(result.pendingTaxReversals[0].id).toBe("recon-2");
    // A prior success exists, but it must NOT suppress the still-pending warning for the second event.
    expect(result.hasSucceededTaxReversal).toBe(true);
  });
});
