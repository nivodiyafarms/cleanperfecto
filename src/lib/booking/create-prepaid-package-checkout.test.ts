import { describe, expect, it } from "vitest";
import { createPrepaidPackageCheckout } from "./create-prepaid-package-checkout";
import type { PrepaidBookingSelectionInput } from "./types";
import { validatePrepaidBookingSelection } from "./validate-prepaid-booking-selection";

function baseSelection(overrides: Partial<PrepaidBookingSelectionInput> = {}): PrepaidBookingSelectionInput {
  return {
    quoteId: "quote-1",
    clientRequestId: "client-req-1",
    frequency: "weekly",
    paymentMethod: "card",
    consentAccepted: true,
    presentedConsentVersionId: "version-1",
    ...overrides,
  };
}

describe("validatePrepaidBookingSelection", () => {
  it("passes for a fully valid selection, including required consent (15)", () => {
    expect(validatePrepaidBookingSelection(baseSelection())).toEqual([]);
  });

  it("rejects when the required consent checkbox was not checked — the prepaid flow requires it too, not just Pay Per Cleaning (4)", () => {
    const errors = validatePrepaidBookingSelection(baseSelection({ consentAccepted: false }));
    expect(errors.some((e) => e.includes("Service Terms"))).toBe(true);
  });

  it("rejects when no consent template version was presented (5, 9)", () => {
    const errors = validatePrepaidBookingSelection(baseSelection({ presentedConsentVersionId: "" }));
    expect(errors.some((e) => e.includes("Service Terms"))).toBe(true);
  });
});

describe("createPrepaidPackageCheckout — server-side enforcement (18)", () => {
  it("rejects a direct call with consentAccepted=false before touching any repository or Stripe dependency", async () => {
    const result = await createPrepaidPackageCheckout(baseSelection({ consentAccepted: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
    }
  });

  it("rejects a direct call with a missing presentedConsentVersionId", async () => {
    const result = await createPrepaidPackageCheckout(baseSelection({ presentedConsentVersionId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
    }
  });
});
