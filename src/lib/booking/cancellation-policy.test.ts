import { describe, expect, it } from "vitest";
import {
  COMBINED_CONSENT_CHECKBOX_COPY,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
} from "./cancellation-policy";

describe("consent/payment-authorization copy (15)", () => {
  it("uses one identical combined checkbox label for both Pay Per Cleaning and Prepaid Package", () => {
    expect(COMBINED_CONSENT_CHECKBOX_COPY).toContain("Service Terms");
    expect(COMBINED_CONSENT_CHECKBOX_COPY).toContain("Cancellation");
    expect(COMBINED_CONSENT_CHECKBOX_COPY).toContain("Payment Authorization");
  });

  it("Pay Per Cleaning payment-authorization copy describes saving a payment method for a later, post-completion charge", () => {
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).toContain("save");
    expect(SAVED_PAYMENT_AUTHORIZATION_COPY.toLowerCase()).not.toContain("paying");
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
