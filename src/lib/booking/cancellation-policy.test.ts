import { describe, expect, it } from "vitest";
import {
  CANCELLATION_POLICY_TIERS,
  CANCELLATION_POLICY_VERSION,
  COMBINED_CONSENT_CHECKBOX_COPY,
  formatCancellationPolicySnapshot,
  NO_ACCESS_FEE_REPLACEMENT_NOTE,
  PREPAID_PACKAGE_CANCELLATION_NOTE,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
} from "./cancellation-policy";

describe("consent/payment-authorization copy (15)", () => {
  it("uses one identical combined checkbox label for both Pay Per Cleaning and Prepaid Package, covering Terms, Cancellation Policy, and payment-method authorization", () => {
    expect(COMBINED_CONSENT_CHECKBOX_COPY).toContain("Terms");
    expect(COMBINED_CONSENT_CHECKBOX_COPY).toContain("Cancellation");
    expect(COMBINED_CONSENT_CHECKBOX_COPY.toLowerCase()).toContain("payment-method authorization");
  });

  it("Pay Per Cleaning payment-authorization copy explicitly authorizes off-session cancellation/rescheduling/no-access fee charging, without a second approval at assessment time", () => {
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("authorize");
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("cancellation, rescheduling, or no-access fee");
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("without requiring additional authorization");
  });

  it("Pay Per Cleaning payment-authorization copy explicitly states regular cleaning charges are NOT automatic — Final Total review-and-Pay still applies", () => {
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("regular cleaning charges are not automatically charged");
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("final total");
  });

  it("Prepaid Package payment-authorization copy describes paying in full today — never post-completion charge language", () => {
    expect(PREPAID_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("today");
    expect(PREPAID_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).not.toContain("after completion");
    expect(PREPAID_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).not.toContain("after your cleaning");
  });

  it("the two payment-authorization copies are distinct — no single wording is blindly reused across contradictory payment mechanics", () => {
    expect(PREPAID_PAYMENT_AUTHORIZATION_COPY).not.toBe(SAVED_PAYMENT_AUTHORIZATION_COPY);
  });
});

describe("CANCELLATION_POLICY_TIERS — exact fee schedule", () => {
  it("renders exactly the four approved fee tiers, in order", () => {
    expect(CANCELLATION_POLICY_TIERS).toHaveLength(4);
    expect(CANCELLATION_POLICY_TIERS.map((t) => t.fee)).toEqual(["No fee", "$25 fee", "$50 fee", "$75 fee"]);
  });

  it("the 48-hour boundary is unambiguous — 'or more' vs 'less than 48' never leaves the exact 48h instant unstated", () => {
    const freeTier = CANCELLATION_POLICY_TIERS[0];
    const midTier = CANCELLATION_POLICY_TIERS[1];
    expect(freeTier.window.toLowerCase()).toContain("48 hours or more");
    expect(midTier.window.toLowerCase()).toContain("less than 48 hours");
  });

  it("the 24-hour boundary is unambiguous — 'at least 24' vs 'less than 24' never leaves the exact 24h instant unstated", () => {
    const midTier = CANCELLATION_POLICY_TIERS[1];
    const lateTier = CANCELLATION_POLICY_TIERS[2];
    expect(midTier.window.toLowerCase()).toContain("at least 24 hours");
    expect(lateTier.window.toLowerCase()).toContain("less than 24 hours");
  });

  it("the dispatched/no-access tier covers both 'cleaner dispatched' and 'unable to access' scenarios", () => {
    const noAccessTier = CANCELLATION_POLICY_TIERS[3];
    expect(noAccessTier.window.toLowerCase()).toContain("dispatched");
    expect(noAccessTier.window.toLowerCase()).toContain("access");
    expect(noAccessTier.fee).toBe("$75 fee");
  });
});

describe("NO_ACCESS_FEE_REPLACEMENT_NOTE — $75 replaces, never stacks", () => {
  it("explicitly states the $75 fee replaces rather than adds to another cancellation fee for the same appointment", () => {
    expect(NO_ACCESS_FEE_REPLACEMENT_NOTE).toContain("$75");
    expect(NO_ACCESS_FEE_REPLACEMENT_NOTE.toLowerCase()).toContain("replaces");
    expect(NO_ACCESS_FEE_REPLACEMENT_NOTE.toLowerCase()).toContain("rather than adds to");
    expect(NO_ACCESS_FEE_REPLACEMENT_NOTE.toLowerCase()).toContain("same appointment");
  });
});

describe("formatCancellationPolicySnapshot", () => {
  it("includes every tier and the $75-replaces note for a normal (non-package) booking", () => {
    const snapshot = formatCancellationPolicySnapshot(false);
    for (const tier of CANCELLATION_POLICY_TIERS) {
      expect(snapshot).toContain(`${tier.window}: ${tier.fee}`);
    }
    expect(snapshot).toContain(NO_ACCESS_FEE_REPLACEMENT_NOTE);
    expect(snapshot).not.toContain(PREPAID_PACKAGE_CANCELLATION_NOTE);
  });

  it("also includes the $75-replaces note (not just the package-specific note) for a prepaid package booking", () => {
    const snapshot = formatCancellationPolicySnapshot(true);
    expect(snapshot).toContain(NO_ACCESS_FEE_REPLACEMENT_NOTE);
    expect(snapshot).toContain(PREPAID_PACKAGE_CANCELLATION_NOTE);
  });

  it("never duplicates the tier/note wording — reads the same source constants the UI renders from, never a second copy", () => {
    const snapshot = formatCancellationPolicySnapshot(false);
    const expectedLineCount = CANCELLATION_POLICY_TIERS.length + 1; // tiers + the replacement note
    expect(snapshot.split("\n")).toHaveLength(expectedLineCount);
  });
});

describe("CANCELLATION_POLICY_VERSION", () => {
  it("was bumped for this wording revision — a historical booking_orders row frozen under the OLD version string remains traceable to different text than a new one", () => {
    expect(CANCELLATION_POLICY_VERSION).not.toBe("2026-08-19b");
    expect(CANCELLATION_POLICY_VERSION).toBe("2026-09-27");
  });
});
