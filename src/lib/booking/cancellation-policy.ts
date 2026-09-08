/**
 * Single source of truth for the approved cancellation/rescheduling fee
 * policy text and its version — shared by the booking-page UI copy and
 * whatever gets persisted as `booking_orders.cancellation_policy_version`
 * (see create-normal-booking-checkout.ts). Bump CANCELLATION_POLICY_VERSION
 * whenever POLICY_TIERS or the summary copy changes, so a historical
 * booking_orders row stays traceable to the exact text the customer saw.
 *
 * Owner-approved 2026-08-19. Actual customer self-service cancellation/
 * rescheduling and off-session fee charging are a future scheduling/
 * customer-portal milestone — this module only records/displays the
 * policy and the customer's acceptance of it.
 */

export const CANCELLATION_POLICY_VERSION = "2026-08-19b";

export interface CancellationPolicyTier {
  window: string;
  fee: string;
}

export const CANCELLATION_POLICY_TIERS: CancellationPolicyTier[] = [
  { window: "48+ hours before your appointment", fee: "Free cancellation or rescheduling" },
  { window: "24–48 hours before your appointment", fee: "$25 late change/cancellation fee" },
  { window: "Less than 24 hours / same day", fee: "$50 late cancellation/rescheduling fee" },
  { window: "Cleaner already dispatched or no access provided", fee: "$75 fee" },
];

export const PREPAID_PACKAGE_CANCELLATION_NOTE =
  "For prepaid packages, a reschedule or cancellation does not use up one of your 6 visits — an applicable late fee is charged separately.";

export const SAVED_PAYMENT_AUTHORIZATION_COPY =
  "I agree to the cancellation/rescheduling policy and authorize CleanPerfecto to securely save my payment method for the approved cleaning charge and applicable late-change fees.";

/**
 * The single required clickwrap checkbox label covering Service Terms +
 * Cancellation/Rescheduling/No-Access Policy + Payment Authorization as
 * ONE combined electronic acceptance — owner-approved wording, used
 * identically for both Pay Per Cleaning and Prepaid Package (the "View
 * Terms & Consent" content next to it is what differs per payment model,
 * not this label). See BookingPaymentClient's checkbox + TermsConsentDialog.
 */
export const COMBINED_CONSENT_CHECKBOX_COPY =
  "I agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization.";

/**
 * Payment-authorization explanation shown inside the "View Terms &
 * Consent" dialog for a Prepaid Package purchase — deliberately different
 * wording from SAVED_PAYMENT_AUTHORIZATION_COPY (normal booking): a
 * package is paid in full at checkout today, so there is no future
 * post-completion charge being authorized here, and no saved-payment-
 * method-for-later-use concept applies. Material scope/price changes to
 * an active package still require the customer's approval before any
 * additional amount is owed (see package_amendments' approval_state).
 */
export const PREPAID_PAYMENT_AUTHORIZATION_COPY =
  "You are paying your full prepaid package total today by the payment method you select below. No further charge is authorized here — any material change to your package scope requires your separate approval before an additional amount is owed.";
