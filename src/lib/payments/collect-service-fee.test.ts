import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { collectServiceFeeExternally } from "./collect-service-fee";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";

async function seedAssessedFee(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"], serviceVisitId = "visit-1") {
  return repo.insertServiceFeeAssessment({
    serviceVisitId,
    feeType: "cancellation",
    amount: 25,
    policyVersion: "v1",
    reason: "less than 24 hours notice",
  });
}

describe("collectServiceFeeExternally — Phase H: cancellation fee collection", () => {
  it("an assessed fee does not automatically imply paid — starts and stays 'assessed' until explicitly collected", async () => {
    const { repo } = createFakeSchedulingRepository();
    const fee = await seedAssessedFee(repo);
    expect(fee.state).toBe("assessed");
    expect(fee.collectedAt).toBeUndefined();
  });

  it("records a successful collection: state -> paid, collection facts persisted, links back to the assessment and its service visit", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const fee = await seedAssessedFee(repo, "visit-42");

    const collected = await collectServiceFeeExternally(repo, {
      feeAssessmentId: fee.id,
      collectionMethod: "zelle",
      externalPaymentReference: "ZL-77",
      actorAdminUserId: "ops-1",
      actorRole: "operations",
    });

    expect(collected.state).toBe("paid");
    expect(collected.collectionMethod).toBe("zelle");
    expect(collected.externalPaymentReference).toBe("ZL-77");
    expect(collected.collectedAt).not.toBeNull();
    expect(collected.amount).toBe(25); // the fee's own frozen amount, never admin-entered

    expect(state.financialAuditLog).toHaveLength(1);
    const [entry] = state.financialAuditLog;
    expect(entry.actionType).toBe("fee_collected");
    expect(entry.targetEntityType).toBe("service_fee_assessment");
    expect(entry.targetEntityId).toBe(fee.id);
    expect(entry.serviceVisitId).toBe("visit-42");
    expect(entry.actorAdminUserId).toBe("ops-1");
  });

  it("no duplicate collection: rejects collecting an already-paid fee", async () => {
    const { repo } = createFakeSchedulingRepository();
    const fee = await seedAssessedFee(repo);
    await collectServiceFeeExternally(repo, { feeAssessmentId: fee.id, collectionMethod: "cash", externalPaymentReference: null, actorAdminUserId: "ops-1", actorRole: "operations" });

    await expect(
      collectServiceFeeExternally(repo, { feeAssessmentId: fee.id, collectionMethod: "cash", externalPaymentReference: null, actorAdminUserId: "ops-1", actorRole: "operations" })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("rejects collecting an already-waived fee — waiver and collection remain mutually exclusive, distinct outcomes", async () => {
    const { repo } = createFakeSchedulingRepository();
    const fee = await seedAssessedFee(repo);
    await repo.waiveServiceFeeAssessmentWithAudit(fee.id, "customer goodwill", { actorAdminUserId: "owner-1", actorRole: "owner_admin" });

    await expect(
      collectServiceFeeExternally(repo, { feeAssessmentId: fee.id, collectionMethod: "cash", externalPaymentReference: null, actorAdminUserId: "ops-1", actorRole: "operations" })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("owner waiver remains its own, separately audited outcome — unaffected by collection existing as a concept", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const fee = await seedAssessedFee(repo);

    const waived = await repo.waiveServiceFeeAssessmentWithAudit(fee.id, "goodwill", { actorAdminUserId: "owner-1", actorRole: "owner_admin" });

    expect(waived.state).toBe("waived");
    expect(state.financialAuditLog).toHaveLength(1);
    expect(state.financialAuditLog[0].actionType).toBe("fee_waived");
  });

  it("a collection attempt that never happens (no call made) leaves the assessment untouched — a payment failure never erases the assessment", async () => {
    const { repo } = createFakeSchedulingRepository();
    const fee = await seedAssessedFee(repo);
    // Simulates: admin never records collection because the customer's Zelle payment never actually arrived.
    const stillAssessed = await repo.insertServiceFeeAssessment({ serviceVisitId: "visit-1", feeType: "no_access", amount: 75, policyVersion: "v1", reason: null });
    expect(stillAssessed.state).toBe("assessed");
    expect(fee.state).toBe("assessed");
  });

  it("never touches prepaid_packages or service_visit_payments — a cancellation fee is never silently netted against package or visit-payment state", async () => {
    const { repo } = createFakeSchedulingRepository({
      prepaidPackages: [
        {
          id: "pkg-1",
          customerId: "customer-1",
          bookingOrderId: "booking-1",
          frequency: "weekly",
          purchasedVisitCount: 6,
          remainingVisitCount: 6,
          packageTotalPaid: 900,
          effectivePricePerVisit: 150,
          status: "active",
          purchasedAt: new Date(),
        },
      ],
    });
    const fee = await seedAssessedFee(repo);

    await collectServiceFeeExternally(repo, { feeAssessmentId: fee.id, collectionMethod: "cash", externalPaymentReference: null, actorAdminUserId: "ops-1", actorRole: "operations" });

    const pkg = await repo.findPrepaidPackageById("pkg-1");
    expect(pkg!.status).toBe("active");
    expect(pkg!.remainingVisitCount).toBe(6);
    expect(pkg!.refundedAmount ?? 0).toBe(0);
    expect(await repo.findServiceVisitPaymentByVisitId("visit-1")).toBeNull();
  });
});
