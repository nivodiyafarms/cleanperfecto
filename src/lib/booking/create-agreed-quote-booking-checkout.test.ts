import { describe, expect, it } from "vitest";
import type { AgreedQuoteInvitationRepository, AgreedQuoteInvitationRow } from "@/lib/instant-quote/agreed-quote-invitation-repository";
import { createAgreedQuoteBookingCheckout, type AgreedQuoteAcceptanceInput } from "./create-agreed-quote-booking-checkout";

function baseInput(overrides: Partial<AgreedQuoteAcceptanceInput> = {}): AgreedQuoteAcceptanceInput {
  return {
    invitationId: "invitation-1",
    customerId: "customer-1",
    consentAccepted: true,
    presentedConsentVersionId: "version-1",
    requestedDate: "2026-11-01",
    requestedStartTime: "10:00",
    ...overrides,
  };
}

function baseInvitationRow(overrides: Partial<AgreedQuoteInvitationRow> = {}): AgreedQuoteInvitationRow {
  const now = new Date().toISOString();
  return {
    id: "invitation-1",
    quoteRequestId: "quote-1",
    customerId: "customer-1",
    createdByAdminUserId: "admin-1",
    status: "sent",
    clientRequestId: "client-req-1",
    negotiationChannel: null,
    negotiationNotes: null,
    agreedRequestedDate: null,
    agreedRequestedStartTime: null,
    resendCount: 0,
    lastSentAt: null,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
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

function throwingInvitationRepo(): AgreedQuoteInvitationRepository {
  const notUsed = async () => {
    throw new Error("invitationRepo should not have been called — a validation failure must short-circuit before any dependency is touched");
  };
  return {
    insertAgreedQuoteInvitation: notUsed,
    findAgreedQuoteInvitationById: notUsed,
    findAgreedQuoteInvitationSummaryById: notUsed,
    listAgreedQuoteInvitationSummaries: notUsed,
    supersedeAgreedQuoteInvitation: notUsed,
    claimAgreedQuoteInvitationSend: notUsed,
    markAgreedQuoteInvitationSendSent: notUsed,
    markAgreedQuoteInvitationSendFailedTerminal: notUsed,
    recordAgreedQuoteInvitationSent: notUsed,
    renewAgreedQuoteInvitation: notUsed,
    linkAgreedQuoteInvitationBookingOrder: notUsed,
    claimAgreedQuoteInvitationCheckout: notUsed,
    claimAgreedQuoteInvitationCancellation: notUsed,
    markAgreedQuoteInvitationCompletedByBookingOrderId: notUsed,
    hasLivePaymentAttemptForBookingOrder: notUsed,
  } as unknown as AgreedQuoteInvitationRepository;
}

describe("createAgreedQuoteBookingCheckout — server-side enforcement", () => {
  it("rejects consentAccepted=false before touching the invitation repository at all", async () => {
    const result = await createAgreedQuoteBookingCheckout(throwingInvitationRepo(), baseInput({ consentAccepted: false }));
    expect(result).toEqual({
      ok: false,
      stage: "validation",
      errors: ["Please agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization to continue."],
    });
  });

  it("rejects a missing presentedConsentVersionId before touching the invitation repository at all", async () => {
    const result = await createAgreedQuoteBookingCheckout(throwingInvitationRepo(), baseInput({ presentedConsentVersionId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("validation");
  });

  it("returns a specific claim_failed reason, without ever constructing a real booking repository or Stripe client, when the atomic claim is refused", async () => {
    const row = baseInvitationRow({ status: "cancelled" });
    const repo: AgreedQuoteInvitationRepository = {
      ...throwingInvitationRepo(),
      async claimAgreedQuoteInvitationCheckout() {
        return null;
      },
      async findAgreedQuoteInvitationById() {
        return row;
      },
    };

    const result = await createAgreedQuoteBookingCheckout(repo, baseInput());
    expect(result).toEqual({ ok: false, stage: "claim_failed", reason: "cancelled" });
  });

  it("collapses a wrong-customer lookup into the same 'not_found' reason as a genuinely missing invitation", async () => {
    const row = baseInvitationRow({ customerId: "someone-else" });
    const repo: AgreedQuoteInvitationRepository = {
      ...throwingInvitationRepo(),
      async claimAgreedQuoteInvitationCheckout() {
        return null;
      },
      async findAgreedQuoteInvitationById() {
        return row;
      },
    };

    const result = await createAgreedQuoteBookingCheckout(repo, baseInput());
    expect(result).toEqual({ ok: false, stage: "claim_failed", reason: "not_found" });
  });

  it("reports 'expired' when the claim fails and the offer's own deadline has passed with no other terminal status", async () => {
    const row = baseInvitationRow({ status: "sent", expiresAt: new Date(Date.now() - 1000).toISOString() });
    const repo: AgreedQuoteInvitationRepository = {
      ...throwingInvitationRepo(),
      async claimAgreedQuoteInvitationCheckout() {
        return null;
      },
      async findAgreedQuoteInvitationById() {
        return row;
      },
    };

    const result = await createAgreedQuoteBookingCheckout(repo, baseInput());
    expect(result).toEqual({ ok: false, stage: "claim_failed", reason: "expired" });
  });
});
