import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => {
  class Resend {
    emails = { send: sendMock };
  }
  return { Resend };
});

const { createResendInstantQuoteEmailSender } = await import("./resend-instant-quote-email-sender");
const { buildInstantQuoteEmailDetails } = await import("./build-email-details");
import type { SubmitInstantQuoteResult } from "../submit-instant-quote";
import type { InstantQuoteRawInput } from "../types";

type OkResult = Extract<SubmitInstantQuoteResult, { ok: true }>;

function rawInput(overrides: Partial<InstantQuoteRawInput> = {}): InstantQuoteRawInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", city: "Frisco", state: "TX", zip: "75056" },
    ...overrides,
  };
}

function okResult(overrides: Partial<OkResult> = {}): OkResult {
  return {
    ok: true,
    quoteId: "33333333-3333-3333-3333-333333333333",
    customerId: "customer-1",
    identityConflict: false,
    estimateType: "instant_range",
    calculatedTotal: 144,
    range: { lower: 145, upper: 165 },
    hasStartingAtPricing: false,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    firstCleaningOfferApplied: false,
    regularRange: null,
    manualReviewRequired: false,
    manualReviewReasons: [],
    minimumServiceTotalApplied: false,
    movePackageLevel: null,
    moveCompleteUpgradeConfigured: null,
    ...overrides,
  };
}

function details(rawOverrides: Partial<InstantQuoteRawInput> = {}, resultOverrides: Partial<OkResult> = {}) {
  return buildInstantQuoteEmailDetails(rawInput(rawOverrides), okResult(resultOverrides));
}

describe("createResendInstantQuoteEmailSender", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    process.env.RESEND_API_KEY = "test-key";
    process.env.QUOTE_NOTIFICATION_EMAILS = "admin1@example.com,admin2@example.com";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.QUOTE_NOTIFICATION_EMAILS;
  });

  describe("sendAdminNotification", () => {
    it("sends one independent email per configured recipient", async () => {
      const sender = createResendInstantQuoteEmailSender();
      const summary = await sender.sendAdminNotification(details());

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({ configured: true, attempted: 2, sent: 2 });
      const recipients = sendMock.mock.calls.map((call) => call[0].to);
      expect(recipients).toEqual(["admin1@example.com", "admin2@example.com"]);
    });

    it("reports per-recipient failure without throwing", async () => {
      sendMock
        .mockResolvedValueOnce({ data: { id: "email_1" }, error: null })
        .mockRejectedValueOnce(new Error("network error"));

      const sender = createResendInstantQuoteEmailSender();
      const summary = await sender.sendAdminNotification(details());

      expect(summary).toEqual({ configured: true, attempted: 2, sent: 1 });
    });

    it("reports unconfigured without attempting a send when no recipients are configured", async () => {
      delete process.env.QUOTE_NOTIFICATION_EMAILS;

      const sender = createResendInstantQuoteEmailSender();
      const summary = await sender.sendAdminNotification(details());

      expect(sendMock).not.toHaveBeenCalled();
      expect(summary).toEqual({ configured: false, attempted: 0, sent: 0 });
    });

    it("handles a missing RESEND_API_KEY without throwing", async () => {
      delete process.env.RESEND_API_KEY;

      const sender = createResendInstantQuoteEmailSender();
      const summary = await sender.sendAdminNotification(details());

      expect(sendMock).not.toHaveBeenCalled();
      expect(summary).toEqual({ configured: true, attempted: 2, sent: 0 });
    });

    it("sends real instant-quote content, not the legacy QuoteForm template", async () => {
      const sender = createResendInstantQuoteEmailSender();
      await sender.sendAdminNotification(details());

      const call = sendMock.mock.calls[0][0];
      expect(call.subject).toContain("New Instant Quote");
      expect(call.text).toContain("33333333-3333-3333-3333-333333333333");
    });
  });

  describe("sendCustomerConfirmation", () => {
    it("sends to the customer's own email with the approved sender and reply-to", async () => {
      const sender = createResendInstantQuoteEmailSender();
      const result = await sender.sendCustomerConfirmation(details());

      expect(result).toEqual({ attempted: true, sent: true });
      const call = sendMock.mock.calls[0][0];
      expect(call.to).toBe("jane@example.com");
      expect(call.from).toBe("CleanPerfecto <support@cleanperfecto.com>");
      expect(call.replyTo).toBe("support@cleanperfecto.com");
      expect(call.subject).toBe("Your CleanPerfecto Cleaning Estimate");
    });

    it("does not attempt a send when there is no customer email — not treated as an error", async () => {
      const sender = createResendInstantQuoteEmailSender();
      const result = await sender.sendCustomerConfirmation(details({ email: undefined }));

      expect(sendMock).not.toHaveBeenCalled();
      expect(result).toEqual({ attempted: false, sent: false });
    });

    it("reports sent:false without throwing when the provider returns an error", async () => {
      sendMock.mockResolvedValue({ data: null, error: { message: "invalid recipient" } });

      const sender = createResendInstantQuoteEmailSender();
      const result = await sender.sendCustomerConfirmation(details());

      expect(result).toEqual({ attempted: true, sent: false });
    });

    it("reports sent:false without throwing when the send rejects", async () => {
      sendMock.mockRejectedValue(new Error("network error"));

      const sender = createResendInstantQuoteEmailSender();
      const result = await sender.sendCustomerConfirmation(details());

      expect(result).toEqual({ attempted: true, sent: false });
    });

    it("handles a missing RESEND_API_KEY without throwing", async () => {
      delete process.env.RESEND_API_KEY;

      const sender = createResendInstantQuoteEmailSender();
      const result = await sender.sendCustomerConfirmation(details());

      expect(sendMock).not.toHaveBeenCalled();
      expect(result).toEqual({ attempted: true, sent: false });
    });
  });
});
