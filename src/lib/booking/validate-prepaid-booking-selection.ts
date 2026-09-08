import type { PaymentMethodType, PrepaidBookingSelectionInput, PrepaidFrequency } from "./types";

const PACKAGE_FREQUENCIES: PrepaidFrequency[] = ["weekly", "biweekly", "every_4_weeks"];
const PAYMENT_METHODS: PaymentMethodType[] = ["card", "us_bank_account"];

/**
 * Pure validation, deliberately kept OUT of create-prepaid-package-checkout.ts:
 * that file is "use server", and Next.js requires every export from a
 * "use server" module to be an async Server Action — a plain sync helper
 * like this one cannot live there. No behavior change from when this was
 * inline; only the module boundary moved.
 */
export function validatePrepaidBookingSelection(raw: PrepaidBookingSelectionInput): string[] {
  const errors: string[] = [];
  if (!raw.clientRequestId) errors.push("Missing request id.");
  if (!PACKAGE_FREQUENCIES.includes(raw.frequency)) errors.push("Please choose a valid package frequency.");
  if (!PAYMENT_METHODS.includes(raw.paymentMethod)) errors.push("Please choose a payment method.");
  if (!raw.consentAccepted || !raw.presentedConsentVersionId) {
    errors.push("Please agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization to continue.");
  }
  return errors;
}
