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

export const CANCELLATION_POLICY_VERSION = "2026-09-27";

export interface CancellationPolicyTier {
  window: string;
  fee: string;
}

/**
 * Boundaries are deliberately worded so every hour maps to EXACTLY one
 * tier — "or more" / "at least ... but less than" / "less than" — never an
 * ambiguous open range like the pre-2026-09-27 "24–48 hours" wording, which
 * left the exact 24h and 48h instants themselves unstated.
 */
export const CANCELLATION_POLICY_TIERS: CancellationPolicyTier[] = [
  { window: "48 hours or more before your scheduled cleaning", fee: "No fee" },
  { window: "At least 24 hours but less than 48 hours before your scheduled cleaning", fee: "$25 fee" },
  { window: "Less than 24 hours before your scheduled cleaning, or same-day cancellation/rescheduling", fee: "$50 fee" },
  { window: "Cleaner dispatched, or CleanPerfecto is unable to access the property at the scheduled time", fee: "$75 fee" },
];

/**
 * Owner-approved 2026-09-27: the $75 dispatched/no-access fee is a
 * REPLACEMENT for whichever $25/$50 late-cancellation fee would otherwise
 * apply to that same appointment — never an additional charge stacked on
 * top of it. Shown alongside CANCELLATION_POLICY_TIERS everywhere they're
 * shown (TermsConsentDialog, formatCancellationPolicySnapshot) so this is
 * never buried only inside generic Terms text.
 */
export const NO_ACCESS_FEE_REPLACEMENT_NOTE =
  "The $75 dispatched/no-access fee replaces rather than adds to another cancellation fee for the same appointment.";

export const PREPAID_PACKAGE_CANCELLATION_NOTE =
  "For prepaid packages, a reschedule or cancellation does not use up one of your 6 visits — an applicable late fee is charged separately.";

/**
 * Pay Per Cleaning payment-authorization copy — owner-approved 2026-09-27
 * rewrite. Two things are authorized here, kept explicitly distinct so
 * neither is confused with the other: (1) off-session authorization to
 * charge the applicable cancellation/rescheduling/no-access fee described
 * in the Cancellation & Rescheduling Policy above, with no second approval
 * asked for when that fee is actually assessed; (2) an explicit statement
 * that this authorization does NOT extend to the regular cleaning charge —
 * that one is still never automatic and always goes through the existing
 * Final Total review-and-Pay flow (see confirm-final-total-and-pay.ts) —
 * see this module's own test coverage for both being explicit.
 */
export const SAVED_PAYMENT_AUTHORIZATION_COPY =
  "By agreeing below, I authorize CleanPerfecto to securely keep my payment method on file and charge the applicable cancellation, rescheduling, or no-access fee described in the Cancellation & Rescheduling Policy without requiring additional authorization at the time the fee is assessed. CleanPerfecto will provide notice or a receipt for any such charge.\n\nRegular cleaning charges are not automatically charged after service. After the cleaning, I will receive my Final Total for review and payment.";

/**
 * The single required clickwrap checkbox label covering Terms +
 * Cancellation/Rescheduling/No-Access Policy + payment-method authorization
 * as ONE combined electronic acceptance — owner-approved wording
 * (2026-09-27 revision), used identically for both Pay Per Cleaning and
 * Prepaid Package (the "View Terms & Consent" content next to it is what
 * differs per payment model, not this label). See BookingPaymentClient's
 * checkbox + TermsConsentDialog.
 */
export const COMBINED_CONSENT_CHECKBOX_COPY =
  "I agree to CleanPerfecto's Terms, Cancellation & Rescheduling Policy, and payment-method authorization.";

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

/**
 * Renders the exact cancellation-policy wording shown to the customer
 * (the same CANCELLATION_POLICY_TIERS array the dialog/disclosure UI
 * renders from, plus PREPAID_PACKAGE_CANCELLATION_NOTE for a package) as
 * one stable text block — frozen verbatim into
 * booking_orders.cancellation_policy_text_snapshot at booking creation.
 * Never a second, independently-maintained copy of the wording: this
 * reads the same source constants the UI does, so storage and display can
 * never drift apart in content, only in formatting.
 */
export function formatCancellationPolicySnapshot(forPrepaidPackage: boolean): string {
  const lines = CANCELLATION_POLICY_TIERS.map((tier) => `${tier.window}: ${tier.fee}`);
  // Applies regardless of payment model — the $75 fee replaces, never
  // stacks with, a $25/$50 fee for the same appointment either way.
  lines.push(NO_ACCESS_FEE_REPLACEMENT_NOTE);
  if (forPrepaidPackage) {
    lines.push(PREPAID_PACKAGE_CANCELLATION_NOTE);
  }
  return lines.join("\n");
}
