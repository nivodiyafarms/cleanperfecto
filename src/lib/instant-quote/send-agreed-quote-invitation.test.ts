import { describe, expect, it, vi } from "vitest";
import type { CustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import type {
  AgreedQuoteInvitationRepository,
  AgreedQuoteInvitationRow,
  AgreedQuoteInvitationSendRow,
  AgreedQuoteInvitationSummary,
} from "./agreed-quote-invitation-repository";
import { renewAgreedQuoteInvitation, sendAgreedQuoteInvitation } from "./send-agreed-quote-invitation";

function baseInvitation(overrides: Partial<AgreedQuoteInvitationRow> = {}): AgreedQuoteInvitationRow {
  const now = new Date().toISOString();
  return {
    id: "invitation-1",
    quoteRequestId: "quote-1",
    customerId: "customer-1",
    createdByAdminUserId: "admin-1",
    status: "sent",
    clientRequestId: "client-request-1",
    negotiationChannel: null,
    negotiationNotes: null,
    agreedRequestedDate: null,
    agreedRequestedStartTime: null,
    resendCount: 0,
    lastSentAt: null,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    renewCount: 0,
    renewedAt: null,
    renewedByAdminUserId: null,
    supersedesInvitationId: null,
    supersededAt: null,
    bookingOrderId: null,
    checkoutStartedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledByAdminUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeRepo(invitation: AgreedQuoteInvitationRow, customerEmail: string | null = "customer@example.com") {
  let current = invitation;
  const sends: AgreedQuoteInvitationSendRow[] = [];
  const renewCalls: unknown[] = [];
  const sentRecordCalls: unknown[] = [];

  const summary: AgreedQuoteInvitationSummary = {
    ...current,
    customerName: "Jordan Lee",
    customerEmail,
    cleaningType: "standard",
    calculationInput: {
      propertyKind: "home",
      cleaningType: "standard",
      condition: "moderate",
      sizeTier: "2br_2ba",
      zip: "75056",
      frequency: "one_time",
      isPrepaidPackage: false,
      visitCount: 1,
      addOnIds: [],
      firstCleaningEligible: false,
      asOf: new Date(),
    },
    calculationResult: {
      estimateType: "instant-range",
      pricingVersion: "manual-agreed-v1",
      calculatedAt: new Date().toISOString(),
      propertyKind: "home",
      cleaningType: "standard",
      condition: "moderate",
      sizeTier: "2br_2ba",
      basePrice: 300,
      roomAdjustments: 0,
      roomAdjustmentConfigured: true,
      specialRoomCharges: [],
      specialRoomChargesTotal: 0,
      specialRoomsConfigured: true,
      squareFootageMultiplier: 1,
      squareFootageConfigured: true,
      conditionMultiplier: 1,
      cleaningSubtotal: 300,
      frequency: "one_time",
      visitCount: 1,
      discountProgram: "none",
      recurringAdjustment: 0,
      packageDiscount: 0,
      travelPercentage: null,
      travelCharge: 0,
      travelConfigured: true,
      suppliesEquipmentCharge: 0,
      suppliesEquipmentConfigured: true,
      pricedAddOns: [],
      pricedAddOnsTotal: 0,
      manualQuoteAddOns: [],
      packageAddOnsTotal: 0,
      packagePricedAddOns: [],
      packageManualQuoteAddOns: [],
      quantifiedAddOns: [],
      quantifiedAddOnsTotal: 0,
      movePackageLevel: null,
      moveDirection: null,
      moveEquivalentDeepTotal: null,
      moveFloorApplied: null,
      moveCompleteUpgrade: null,
      moveCompleteUpgradeConfigured: null,
      includedByCompletePackage: [],
      completePackageRecommended: false,
      outdoorCharges: [],
      outdoorChargesTotal: 0,
      outdoorManualCharges: [],
      activeFirstCleaningOfferPercent: null,
      firstCleaningEligible: false,
      firstCleaningDiscount: 0,
      preDiscountTotal: 300,
      calculatedTotal: 300,
      hasStartingAtPricing: false,
      prepaidPackageTotal: null,
      effectivePricePerVisit: null,
      minimumServiceTotalApplied: false,
      range: { lower: 300, upper: 300 },
      recommendedService: null,
      manualReviewRequired: false,
      manualReviewReasons: [],
    },
  };

  const repo: AgreedQuoteInvitationRepository = {
    async insertAgreedQuoteInvitation() {
      throw new Error("not used");
    },
    async findAgreedQuoteInvitationById() {
      return current;
    },
    async findAgreedQuoteInvitationSummaryById() {
      return { ...summary, ...current };
    },
    async listAgreedQuoteInvitationSummaries() {
      return [summary];
    },
    async supersedeAgreedQuoteInvitation() {
      return null;
    },
    async claimAgreedQuoteInvitationSend(invitationId, idempotencyKey) {
      const row: AgreedQuoteInvitationSendRow = { id: `send-${sends.length + 1}`, invitationId, idempotencyKey, status: "sending", failureReason: null };
      sends.push(row);
      return row;
    },
    async markAgreedQuoteInvitationSendSent() {},
    async markAgreedQuoteInvitationSendFailedTerminal() {},
    async recordAgreedQuoteInvitationSent(invitationId, nextResendCount, sentAt) {
      sentRecordCalls.push({ invitationId, nextResendCount, sentAt });
      current = { ...current, resendCount: nextResendCount, lastSentAt: sentAt.toISOString(), status: current.status === "pending_send" ? "sent" : current.status };
    },
    async renewAgreedQuoteInvitation(invitationId, nextExpiresAt, nextRenewCount, renewedAt, renewedByAdminUserId) {
      renewCalls.push({ invitationId, nextExpiresAt, nextRenewCount, renewedAt, renewedByAdminUserId });
      if (current.status === "completed" || current.status === "cancelled" || current.status === "superseded") return null;
      current = { ...current, expiresAt: nextExpiresAt.toISOString(), renewCount: nextRenewCount, renewedAt: renewedAt.toISOString(), renewedByAdminUserId };
      return current;
    },
    async linkAgreedQuoteInvitationBookingOrder() {
      throw new Error("not used");
    },
    async claimAgreedQuoteInvitationCheckout() {
      throw new Error("not used");
    },
    async claimAgreedQuoteInvitationCancellation() {
      throw new Error("not used");
    },
    async markAgreedQuoteInvitationCompletedByBookingOrderId() {},
    async hasLivePaymentAttemptForBookingOrder() {
      return false;
    },
  };

  return { repo, sends, renewCalls, sentRecordCalls, getCurrent: () => current };
}

function okAuthLinkGenerator(): CustomerAuthLinkGenerator {
  return { async generate(_email, path) { return { ok: true, actionLink: `https://cleanperfecto.com${path}` }; } };
}

function okEmailSender(): NotificationEmailSender {
  return { async send() { return { sent: true, providerMessageId: "msg-1" }; } };
}

describe("sendAgreedQuoteInvitation", () => {
  it("sends successfully and bumps resend_count/last_sent_at without touching expires_at", async () => {
    const { repo, getCurrent } = fakeRepo(baseInvitation({ status: "pending_send", resendCount: 0 }));
    const expiresBefore = getCurrent().expiresAt;

    const result = await sendAgreedQuoteInvitation(
      { invitationRepo: repo, authLinkGenerator: okAuthLinkGenerator(), emailSender: okEmailSender(), sleep: async () => {} },
      "invitation-1"
    );

    expect(result).toEqual({ ok: true });
    expect(getCurrent().resendCount).toBe(1);
    expect(getCurrent().expiresAt).toBe(expiresBefore);
    expect(getCurrent().status).toBe("sent");
  });

  it("rejects when the customer has no email on file", async () => {
    const { repo } = fakeRepo(baseInvitation(), null);
    const result = await sendAgreedQuoteInvitation({ invitationRepo: repo, authLinkGenerator: okAuthLinkGenerator(), emailSender: okEmailSender() }, "invitation-1");
    expect(result).toEqual({ ok: false, reason: "customer_missing_email" });
  });

  it("rejects once the invitation is completed/cancelled/superseded", async () => {
    const { repo } = fakeRepo(baseInvitation({ status: "cancelled" }));
    const result = await sendAgreedQuoteInvitation({ invitationRepo: repo, authLinkGenerator: okAuthLinkGenerator(), emailSender: okEmailSender() }, "invitation-1");
    expect(result).toEqual({ ok: false, reason: "invalid_state" });
  });

  it("surfaces link-generation failure without sending an email", async () => {
    const { repo } = fakeRepo(baseInvitation());
    const failingGenerator: CustomerAuthLinkGenerator = { async generate() { return { ok: false, reason: "boom" }; } };
    const send = vi.fn(okEmailSender().send);
    const result = await sendAgreedQuoteInvitation({ invitationRepo: repo, authLinkGenerator: failingGenerator, emailSender: { send } }, "invitation-1");
    expect(result).toEqual({ ok: false, reason: "link_generation_failed" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("renewAgreedQuoteInvitation", () => {
  it("extends expires_at to a fresh window and then sends a fresh link", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { repo, getCurrent } = fakeRepo(baseInvitation({ expiresAt: past, status: "sent" }));

    const result = await renewAgreedQuoteInvitation(
      { invitationRepo: repo, authLinkGenerator: okAuthLinkGenerator(), emailSender: okEmailSender(), sleep: async () => {} },
      "invitation-1",
      "admin-2"
    );

    expect(result).toEqual({ ok: true });
    expect(new Date(getCurrent().expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(getCurrent().renewCount).toBe(1);
    expect(getCurrent().renewedByAdminUserId).toBe("admin-2");
  });

  it("refuses to renew a completed/cancelled/superseded invitation", async () => {
    const { repo } = fakeRepo(baseInvitation({ status: "completed" }));
    const result = await renewAgreedQuoteInvitation({ invitationRepo: repo, authLinkGenerator: okAuthLinkGenerator(), emailSender: okEmailSender() }, "invitation-1", "admin-2");
    expect(result).toEqual({ ok: false, reason: "invalid_state" });
  });
});
