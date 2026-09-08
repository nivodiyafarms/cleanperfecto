import type { FrequencyId } from "@/lib/pricing/types";
import { isWithinOperatingHours } from "./operating-hours";
import type { NormalBookingSelectionInput } from "./types";

const NORMAL_FREQUENCIES: FrequencyId[] = ["one_time", "weekly", "biweekly", "every_4_weeks"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure validation, deliberately kept OUT of create-normal-booking-checkout.ts:
 * that file is "use server", and Next.js requires every export from a
 * "use server" module to be an async Server Action — a plain sync helper
 * like this one cannot live there. No behavior change from when this was
 * inline; only the module boundary moved.
 */
export function validateNormalBookingSelection(raw: NormalBookingSelectionInput): string[] {
  const errors: string[] = [];
  if (!raw.clientRequestId) errors.push("Missing request id.");
  if (!NORMAL_FREQUENCIES.includes(raw.frequency)) errors.push("Please choose a valid cleaning frequency.");
  if (!DATE_PATTERN.test(raw.requestedDate)) errors.push("Please choose a preferred date.");
  if (!isWithinOperatingHours(raw.requestedStartTime)) {
    errors.push("Please choose a preferred start time between 8:00 AM and 6:00 PM.");
  }
  if (!raw.paymentMethodSaveAuthorized) {
    errors.push(
      "Please authorize CleanPerfecto to securely save your payment method and accept the cancellation/rescheduling policy to continue."
    );
  }
  if (!raw.consentAccepted || !raw.presentedConsentVersionId) {
    errors.push("Please agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization to continue.");
  }
  return errors;
}
