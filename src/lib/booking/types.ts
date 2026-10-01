import type {
  AddOnId,
  CalculationInput,
  CalculationResult,
  FrequencyId,
  MovePackageLevel,
  OutdoorSelection,
  QuantifiedAddOnSelection,
  SpecialRoomId,
} from "@/lib/pricing/types";

export type BookingType = "normal" | "prepaid_package";

export type PrepaidFrequency = "weekly" | "biweekly" | "every_4_weeks";

export type TimeWindow = "morning" | "afternoon" | "evening";

/**
 * This milestone's code only ever sets draft -> awaiting_payment_method |
 * awaiting_payment -> pending_confirmation | payment_completed.
 * cancelled/confirmed are reserved for future admin/scheduling work — see
 * the create_booking_orders migration.
 */
export type BookingOrderStatus =
  | "draft"
  | "awaiting_payment_method"
  | "awaiting_payment"
  | "payment_completed"
  | "pending_confirmation"
  | "cancelled"
  | "confirmed";

export type PaymentAttemptMode = "setup" | "payment";

/** Which Stripe payment method a prepaid payment attempt is restricted to — see createPrepaidCardCheckoutSession/createPrepaidAchCheckoutSession. Never meaningful for a setup-mode attempt. */
export type PaymentMethodType = "card" | "us_bank_account";

export type PaymentAttemptStatus = "created" | "processing" | "completed" | "expired" | "canceled" | "failed";

export type PrepaidPackageStatus = "active" | "completed" | "cancelled";

export type WebhookProcessingStatus = "received" | "processing" | "processed" | "failed";

/**
 * A quote_requests row, narrowed to exactly what booking needs. Read via
 * the SELECT grant added for this milestone — never written back.
 */
export interface QuoteRequestForBookingRow {
  id: string;
  customerId: string | null;
  estimateType: "instant_range" | "manual_review" | null;
  cleaningType: "standard" | "deep" | "move" | null;
  /** The full CalculationInput/CalculationResult captured at quote time — the base for every recomputed booking option below. Never mutated; a booking freezes its own separate snapshot. */
  pricingSnapshot: { input: CalculationInput; result: CalculationResult } | null;
  emailNormalized: string | null;
  phoneNormalized: string | null;
  serviceAddressIdentity: string | null;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
}

export type NotBookableReason = "not_found" | "manual_review" | "customer_identity_conflict";

/** The active consent_versions row shape the booking page/client needs — never the full repository record. */
export interface ConsentVersionSummary {
  id: string;
  versionLabel: string;
  title: string;
  bodyText: string;
  isLegallyReviewed: boolean;
}

export interface BookableQuote {
  quoteId: string;
  customerId: string;
  cleaningType: "standard" | "deep" | "move";
  baseInput: CalculationInput;
  emailNormalized: string | null;
  phoneNormalized: string | null;
  serviceAddressIdentity: string | null;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
}

/**
 * One option per normal frequency (the "first visit" price, using the
 * customer's actually-resolved first-cleaning eligibility), plus one per
 * prepaid package frequency, plus — for the 3 recurring normal frequencies
 * only — a parallel "future visit" price computed with
 * firstCleaningEligible forced to false (never eligible again, since the
 * first-cleaning offer only applies once). All computed server-side in a
 * single pass, reusing the same calculateEstimate() call with one flag
 * flipped — never a duplicated formula. See build-booking-pricing-options.ts.
 */
export interface BookingPricingOptions {
  normal: Record<FrequencyId, CalculationResult>;
  futureRecurring: Record<Exclude<FrequencyId, "one_time">, CalculationResult>;
  packages: Record<PrepaidFrequency, CalculationResult>;
}

export interface NormalBookingSelectionInput {
  quoteId: string;
  clientRequestId: string;
  frequency: FrequencyId;
  requestedDate: string;
  /** "HH:MM" (24-hour), within the approved 08:00-17:00 operating-hours window. Still a request, not a guaranteed slot. Replaces the old Morning/Afternoon/Evening picker. */
  requestedStartTime: string;
  addOnIds: AddOnId[];
  /** Optional dedicated Game Room / Media-Theater Room selections carried from the quote's post-estimate customization. */
  specialRooms?: SpecialRoomId[];
  /** Only meaningful when the quote's cleaningType is "move"; defaults to "basic" when omitted. */
  movePackageLevel?: MovePackageLevel;
  outdoorSelection?: OutdoorSelection;
  quantifiedAddOns?: QuantifiedAddOnSelection[];
  paymentMethodSaveAuthorized: boolean;
  /** Required clickwrap acceptance of Service Terms + Cancellation/Rescheduling Policy + Payment Authorization — see BookingConsentCheckbox. */
  consentAccepted: boolean;
  /** The consent_versions.id actually rendered to the customer alongside the checkbox — validated server-side against the current active version, never trusted blindly. See acceptConsentClickwrap. */
  presentedConsentVersionId: string;
}

export interface PrepaidBookingSelectionInput {
  quoteId: string;
  clientRequestId: string;
  frequency: PrepaidFrequency;
  paymentMethod: PaymentMethodType;
  /** Required clickwrap acceptance — same semantics as NormalBookingSelectionInput, worded for the prepaid payment model. */
  consentAccepted: boolean;
  presentedConsentVersionId: string;
}

export interface BookingOrderRow {
  id: string;
  customerId: string;
  quoteRequestId: string;
  clientRequestId: string;
  bookingType: BookingType;
  cleaningType: "standard" | "deep" | "move";
  frequency: FrequencyId;
  visitCount: number;
  status: BookingOrderStatus;
  paymentAuthorizationAcceptedAt: string | null;
  pricingVersion: string;
  pricingSnapshot: { input: CalculationInput; result: CalculationResult };
  calculatedTotal: number;
  displayRangeLower: number | null;
  displayRangeUpper: number | null;
  prepaidPackageTotal: number | null;
  effectivePricePerVisit: number | null;
  hasStartingAtPricing: boolean;
  manualReviewReasons: string[];
  selectedAddOnIds: AddOnId[];
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
  requestedDate: string | null;
  /** Legacy — no longer written by new normal bookings, kept for historical rows only. See requestedStartTime. */
  requestedTimeWindow: TimeWindow | null;
  /** A specific requested start time, "HH:MM" (24-hour), within the approved 08:00-17:00 operating-hours window. Still a request, not a guaranteed slot. Replaces requestedTimeWindow going forward. */
  requestedStartTime: string | null;
  /** Which cancellation-policy text version the customer accepted, recorded alongside paymentAuthorizationAcceptedAt. Null for rows created before this policy existed or for a prepaid package (no saved-payment authorization checkbox — see cancellation-policy.ts). */
  cancellationPolicyVersion: string | null;
  /** The exact Payment Authorization copy shown for THIS booking (SAVED_PAYMENT_AUTHORIZATION_COPY or PREPAID_PAYMENT_AUTHORIZATION_COPY), frozen verbatim at booking creation — durable evidence of the exact wording accepted, not just a version tag. Null for rows created before this evidence was captured. See 20260827090400's migration comment. */
  paymentAuthorizationTextSnapshot: string | null;
  /** Which consent_versions row (Service Terms) applied to THIS booking's combined checkbox — the same server-validated active-version id used for the customer's customer_consents row in the same request. consent_versions rows are immutable, so this is a durable pointer to the exact text shown. Null for rows created before this evidence was captured. See 20260827090500's migration comment. */
  consentVersionId: string | null;
  /** The exact cancellation/rescheduling/no-access wording shown for THIS booking, frozen verbatim (see formatCancellationPolicySnapshot). cancellationPolicyVersion alone is only a version tag, not durably-versioned text. Null for rows created before this evidence was captured. */
  cancellationPolicyTextSnapshot: string | null;
}

export interface NewBookingOrderRow {
  customerId: string;
  quoteRequestId: string;
  clientRequestId: string;
  bookingType: BookingType;
  cleaningType: "standard" | "deep" | "move";
  frequency: FrequencyId;
  visitCount: number;
  paymentAuthorizationAcceptedAt: string | null;
  pricingVersion: string;
  pricingSnapshot: { input: CalculationInput; result: CalculationResult };
  calculatedTotal: number;
  displayRangeLower: number | null;
  displayRangeUpper: number | null;
  prepaidPackageTotal: number | null;
  effectivePricePerVisit: number | null;
  hasStartingAtPricing: boolean;
  manualReviewReasons: string[];
  selectedAddOnIds: AddOnId[];
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
  requestedDate: string | null;
  requestedTimeWindow: TimeWindow | null;
  requestedStartTime: string | null;
  cancellationPolicyVersion: string | null;
  /** Optional — defaults to null in the repository when omitted, so every pre-existing caller/test stays valid. Real booking-creation callers (createNormalBookingCheckout/createPrepaidPackageCheckout) always pass it explicitly. */
  paymentAuthorizationTextSnapshot?: string | null;
  /** Optional — defaults to null when omitted. Server-derived only (from acceptConsentClickwrap's validated return value) — never accepted as raw client input. */
  consentVersionId?: string | null;
  /** Optional — defaults to null when omitted. Server-derived only (formatCancellationPolicySnapshot) — never accepted as raw client input. */
  cancellationPolicyTextSnapshot?: string | null;
}

export interface PaymentAttemptRow {
  id: string;
  bookingOrderId: string;
  mode: PaymentAttemptMode;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  stripeSetupIntentId: string | null;
  stripePaymentIntentId: string | null;
  amount: number | null;
  currency: string;
  status: PaymentAttemptStatus;
  paymentMethodType: PaymentMethodType | null;
  packageSubtotalBeforeAchIncentive: number | null;
  achSavingsAmount: number | null;
}

export interface NewPaymentAttemptRow {
  bookingOrderId: string;
  mode: PaymentAttemptMode;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  amount: number | null;
  paymentMethodType: PaymentMethodType | null;
  packageSubtotalBeforeAchIncentive: number | null;
  achSavingsAmount: number | null;
}

export interface PaymentAttemptStatusPatch {
  status: PaymentAttemptStatus;
  stripeSetupIntentId?: string;
  stripePaymentIntentId?: string;
}

export interface NewPrepaidPackageRow {
  customerId: string;
  bookingOrderId: string;
  frequency: PrepaidFrequency;
  packageTotalPaid: number;
  effectivePricePerVisit: number;
  /** The real Stripe Tax collected on this purchase (Checkout Session total_details.amount_tax), or null when never recorded (TAX_MODE disabled, or unavailable). Never included in packageTotalPaid. */
  taxAmount: number | null;
  /** The exact Stripe-settled Checkout Session amount_total (packageTotalPaid + taxAmount) — persisted directly from Stripe, not computed by addition here. */
  totalAmountPaid: number | null;
  /** The committed Stripe Tax transaction id for this purchase, if any. */
  stripeTaxTransactionId: string | null;
}

export interface WebhookClaim {
  /** false when a 'processed' row already exists for this event id — a true, safe no-op; caller must not reprocess. */
  shouldProcess: boolean;
  eventRowId: string;
}
