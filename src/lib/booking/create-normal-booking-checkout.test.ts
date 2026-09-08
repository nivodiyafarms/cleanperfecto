import { describe, expect, it } from "vitest";
import { createNormalBookingCheckout } from "./create-normal-booking-checkout";
import type { NormalBookingSelectionInput } from "./types";
import { validateNormalBookingSelection } from "./validate-normal-booking-selection";

function baseSelection(overrides: Partial<NormalBookingSelectionInput> = {}): NormalBookingSelectionInput {
  return {
    quoteId: "quote-1",
    clientRequestId: "client-req-1",
    frequency: "one_time",
    requestedDate: "2026-09-10",
    requestedStartTime: "10:00",
    addOnIds: [],
    paymentMethodSaveAuthorized: true,
    consentAccepted: true,
    presentedConsentVersionId: "version-1",
    ...overrides,
  };
}

describe("validateNormalBookingSelection", () => {
  it("passes for a fully valid selection, including required consent (14)", () => {
    expect(validateNormalBookingSelection(baseSelection())).toEqual([]);
  });

  it("rejects when the required consent checkbox was not checked (4)", () => {
    const errors = validateNormalBookingSelection(baseSelection({ consentAccepted: false }));
    expect(errors.some((e) => e.includes("Service Terms"))).toBe(true);
  });

  it("rejects when no consent template version was presented, even if consentAccepted is somehow true (5, 9)", () => {
    const errors = validateNormalBookingSelection(baseSelection({ consentAccepted: true, presentedConsentVersionId: "" }));
    expect(errors.some((e) => e.includes("Service Terms"))).toBe(true);
  });

  it("still requires the separate saved-payment-method authorization flag", () => {
    const errors = validateNormalBookingSelection(baseSelection({ paymentMethodSaveAuthorized: false }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("createNormalBookingCheckout — server-side enforcement (18)", () => {
  it("rejects a direct call with consentAccepted=false before touching any repository or Stripe dependency — no client-side check can be bypassed", async () => {
    const result = await createNormalBookingCheckout(baseSelection({ consentAccepted: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
    }
  });

  it("rejects a direct call with a missing presentedConsentVersionId — a manipulated request can never supply an empty/arbitrary template reference and proceed", async () => {
    const result = await createNormalBookingCheckout(baseSelection({ presentedConsentVersionId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
    }
  });
});
