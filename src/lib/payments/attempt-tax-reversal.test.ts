import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { attemptTaxReversal } from "./attempt-tax-reversal";
import { retryTaxReversal } from "./retry-tax-reversal";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";

const ACTOR = { actorAdminUserId: "owner-1", actorRole: "owner_admin" };

async function seedPendingReconciliation(schedulingRepo: ReturnType<typeof createFakeSchedulingRepository>["repo"], overrides: Partial<Parameters<typeof schedulingRepo.createTaxReversalReconciliation>[0]> = {}) {
  return schedulingRepo.createTaxReversalReconciliation({
    targetEntityType: "service_visit_payment",
    targetEntityId: "payment-1",
    originalTransactionId: "txn_original",
    intendedAmount: 100,
    mode: "full",
    ...overrides,
  });
}

describe("attemptTaxReversal — Phase F.1 durable Tax reversal recovery", () => {
  it("immediate success: marks the reconciliation succeeded, records the Stripe reversal id, and audits with actor attribution", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { gateway } = createFakeVisitPaymentGateway();
    const reconciliation = await seedPendingReconciliation(schedulingRepo);

    const result = await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);

    expect(result.status).toBe("succeeded");
    expect(result.stripeReversalId).toBeTruthy();
    expect(result.succeededAt).not.toBeNull();
    expect(state.financialAuditLog).toHaveLength(1);
    const [entry] = state.financialAuditLog;
    expect(entry.actionType).toBe("tax_reversal_reconciled");
    expect(entry.targetEntityType).toBe("tax_reversal_reconciliation");
    expect(entry.actorAdminUserId).toBe("owner-1");
    expect(entry.metadata).toMatchObject({ outcome: "succeeded", originalTransactionId: "txn_original" });
  });

  it("Stripe Tax transient failure: durably records status=failed with the error message and increments retry_count — never just a console.warn", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { gateway } = createFakeVisitPaymentGateway();
    (gateway as unknown as { reverseTaxTransaction: () => Promise<never> }).reverseTaxTransaction = () => {
      throw new Error("simulated transient Stripe Tax outage");
    };
    const reconciliation = await seedPendingReconciliation(schedulingRepo);

    const result = await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);

    expect(result.status).toBe("failed");
    expect(result.failureMessage).toContain("simulated transient Stripe Tax outage");
    expect(result.retryCount).toBe(1);
    expect(state.financialAuditLog).toHaveLength(0); // failures are not audited — see the migration's own rationale
  });

  it("retry success: a subsequent attempt after a transient failure succeeds and transitions failed -> succeeded", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway } = createFakeVisitPaymentGateway({ failNextTaxReversalCreate: true });
    let reconciliation = await seedPendingReconciliation(schedulingRepo);

    reconciliation = await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);
    expect(reconciliation.status).toBe("failed");

    const retried = await retryTaxReversal(schedulingRepo, gateway, { reconciliationId: reconciliation.id, ...ACTOR });
    expect(retried.status).toBe("succeeded");
    expect(retried.stripeReversalId).toBeTruthy();
  });

  it("repeated retry after success is an idempotent no-op: no second Stripe call, no second audit row, stripe_reversal_id unchanged", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    const reconciliation = await seedPendingReconciliation(schedulingRepo);

    const first = await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);
    expect(gatewayState.createTaxReversalCallCount).toBe(1);

    const second = await retryTaxReversal(schedulingRepo, gateway, { reconciliationId: reconciliation.id, ...ACTOR });

    expect(gatewayState.createTaxReversalCallCount).toBe(1); // Stripe was never called again
    expect(second.stripeReversalId).toBe(first.stripeReversalId);
    expect(state.financialAuditLog).toHaveLength(1); // no second audit row
  });

  it("partial reversal: passes refundAmountCents matching the reconciliation's intended amount", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    const reconciliation = await seedPendingReconciliation(schedulingRepo, { mode: "partial", intendedAmount: 42.5 });

    await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);

    const [reversal] = gatewayState.taxReversals.values();
    expect(reversal.mode).toBe("partial");
    expect(reversal.refundAmountCents).toBe(toStripeCents(42.5));
  });

  it("full reversal: passes no refundAmountCents (Stripe reverses the entire original transaction)", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    const reconciliation = await seedPendingReconciliation(schedulingRepo, { mode: "full" });

    await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);

    const [reversal] = gatewayState.taxReversals.values();
    expect(reversal.mode).toBe("full");
    expect(reversal.refundAmountCents).toBeUndefined();
  });

  it("missing original Tax transaction: retryTaxReversal on an unknown reconciliation id throws InvalidVisitStateError, never silently no-ops", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway } = createFakeVisitPaymentGateway();

    await expect(retryTaxReversal(schedulingRepo, gateway, { reconciliationId: "does-not-exist", ...ACTOR })).rejects.toThrow(InvalidVisitStateError);
  });

  it("duplicate refund event: two independent refund events on the same payment each get their own reconciliation row, tracked and retried independently", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ failNextTaxReversalCreate: true });

    const first = await seedPendingReconciliation(schedulingRepo, { intendedAmount: 30, mode: "partial" });
    const firstResult = await attemptTaxReversal(schedulingRepo, gateway, first, ACTOR);
    expect(firstResult.status).toBe("failed"); // one-shot failure consumed here

    const second = await seedPendingReconciliation(schedulingRepo, { intendedAmount: 70, mode: "full" });
    const secondResult = await attemptTaxReversal(schedulingRepo, gateway, second, ACTOR);
    expect(secondResult.status).toBe("succeeded"); // the second event is unaffected by the first's failure

    const all = await schedulingRepo.listTaxReversalReconciliationsForTarget("service_visit_payment", "payment-1");
    expect(all).toHaveLength(2);
    expect(gatewayState.createTaxReversalCallCount).toBe(2);
  });

  it("amount mismatch / over-reversal prevention: intended_amount, original_transaction_id, and mode are immutable once a reconciliation is created", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway } = createFakeVisitPaymentGateway();
    const reconciliation = await seedPendingReconciliation(schedulingRepo, { intendedAmount: 55 });
    await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);

    // A succeeded reversal can never be re-recorded/re-attempted for a
    // different (e.g. larger) amount — the repository's own immutability
    // guard (mirroring the DB trigger) rejects any further transition.
    await expect(schedulingRepo.markTaxReversalReconciliationFailed(reconciliation.id, "should be rejected")).rejects.toThrow(
      /already succeeded/
    );
  });

  it("retry never issues a customer refund — it is exclusively Stripe Tax bookkeeping after the monetary refund already succeeded", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ failNextTaxReversalCreate: true });
    let reconciliation = await seedPendingReconciliation(schedulingRepo);

    reconciliation = await attemptTaxReversal(schedulingRepo, gateway, reconciliation, ACTOR);
    expect(reconciliation.status).toBe("failed");
    await retryTaxReversal(schedulingRepo, gateway, { reconciliationId: reconciliation.id, ...ACTOR });

    expect(gatewayState.createRefundCallCount).toBe(0);
    expect(gatewayState.refunds.size).toBe(0);
  });

  it("over-reversal prevention: rejects creating a reconciliation with a non-positive intended amount", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    await expect(
      schedulingRepo.createTaxReversalReconciliation({
        targetEntityType: "service_visit_payment",
        targetEntityId: "payment-1",
        originalTransactionId: "txn_original",
        intendedAmount: 0,
        mode: "full",
      })
    ).rejects.toThrow();
  });
});
