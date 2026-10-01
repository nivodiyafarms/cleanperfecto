"use client";

import { useMemo, useState } from "react";
import { createNormalBookingCheckout } from "@/lib/booking/create-normal-booking-checkout";
import { createPrepaidPackageCheckout } from "@/lib/booking/create-prepaid-package-checkout";
import {
  CANCELLATION_POLICY_TIERS,
  COMBINED_CONSENT_CHECKBOX_COPY,
  NO_ACCESS_FEE_REPLACEMENT_NOTE,
  PREPAID_PACKAGE_CANCELLATION_NOTE,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
} from "@/lib/booking/cancellation-policy";
import type { AchPackagePricing } from "@/lib/booking/ach-package-options";
import { NORMAL_FREQUENCY_LABELS, PREPAID_FREQUENCY_LABELS } from "@/lib/booking/labels";
import { OPERATING_HOURS_END, OPERATING_HOURS_START } from "@/lib/booking/operating-hours";
import type { BookingPricingOptions, ConsentVersionSummary, PaymentMethodType, PrepaidFrequency } from "@/lib/booking/types";
import { resolveCustomerBookingPrice } from "@/lib/pricing/customer-booking-price";
import type { CalculationResult, FrequencyId } from "@/lib/pricing/types";
import { SITE_CONTACT } from "@/lib/site-contact";
import type { AddOnSelection } from "@/components/quote-wizard/map-form-to-raw-input";
import GlassPanel from "@/components/ui/GlassPanel";
import TermsConsentDialog from "@/components/booking/TermsConsentDialog";

const NORMAL_FREQUENCIES: FrequencyId[] = ["one_time", "weekly", "biweekly", "every_4_weeks"];
const PACKAGE_FREQUENCIES: PrepaidFrequency[] = ["weekly", "biweekly", "every_4_weeks"];

const GENERIC_ERROR_MESSAGE = `Something went wrong. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isRecurring(frequency: FrequencyId): frequency is Exclude<FrequencyId, "one_time"> {
  return frequency !== "one_time";
}

/**
 * Extras summary built entirely from the already-computed, trusted
 * CalculationResult breakdown — never re-derives labels/prices from the raw
 * selection, so bundle folding (e.g. Refrigerator+Oven -> the bundle) and
 * Complete-package inclusion are always reflected correctly without
 * duplicating that logic here.
 */
function extrasSummary(result: CalculationResult): string[] {
  return [
    ...result.pricedAddOns.map((entry) => entry.label),
    ...result.manualQuoteAddOns.map((entry) => entry.label),
    ...result.specialRoomCharges.map((entry) => entry.label),
    ...result.quantifiedAddOns.map((entry) => `${entry.label} ×${entry.quantity}`),
    ...result.outdoorCharges.map((entry) => entry.label),
    ...result.outdoorManualCharges.map((entry) => entry.label),
  ];
}

interface BookingPaymentClientProps {
  quoteId: string;
  defaultFrequency: FrequencyId;
  /** The full post-estimate customization selection carried from the quote's booking handoff — see customization-selection-params.ts. */
  selection: AddOnSelection;
  normalOptions: BookingPricingOptions["normal"];
  futureRecurringOptions: BookingPricingOptions["futureRecurring"];
  packageOptions: BookingPricingOptions["packages"];
  /** Server-authoritative ACH display pricing per package frequency — see ach-package-options.ts. Never computed client-side. */
  achPackageOptions: Record<PrepaidFrequency, AchPackagePricing | null>;
  /** Server-computed via canCreateStripeSetup()/canCreateStripeCharge() — see the booking page. When false, the matching section's Stripe action is replaced with an unavailable message rather than inviting a flow that would only fail server-side. */
  stripeSetupAvailable: boolean;
  stripeChargeAvailable: boolean;
  /** The currently active consent_versions row, resolved server-side (see the booking page) — never fetched client-side. Null when no consent template is configured, in which case booking is unavailable rather than silently skipping the required acceptance. */
  activeConsentVersion: ConsentVersionSummary | null;
}

interface RequiredConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onViewTerms: () => void;
  showValidationError: boolean;
}

/**
 * The single required clickwrap checkbox — unchecked by default, never
 * pre-checked or implicitly accepted by any other action. "View Terms &
 * Consent" is a separate control that only opens the read-only dialog; it
 * never toggles or implies acceptance of the checkbox itself.
 */
function RequiredConsentCheckbox({ id, checked, onChange, onViewTerms, showValidationError }: RequiredConsentCheckboxProps) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="flex items-start gap-3 text-sm text-foreground">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={showValidationError}
          className="mt-0.5 h-4 w-4 rounded border-border text-secondary focus:ring-primary/50"
        />
        <span>{COMBINED_CONSENT_CHECKBOX_COPY}</span>
      </label>
      <button
        type="button"
        onClick={onViewTerms}
        className="mt-1.5 ml-7 text-xs font-medium text-secondary underline decoration-secondary/40 underline-offset-2"
      >
        View Terms &amp; Consent
      </button>
      {showValidationError && (
        <p role="alert" className="mt-1.5 ml-7 text-xs font-medium text-red-700">
          Please check the box above to continue.
        </p>
      )}
    </div>
  );
}

export default function BookingPaymentClient({
  quoteId,
  defaultFrequency,
  selection,
  normalOptions,
  futureRecurringOptions,
  packageOptions,
  achPackageOptions,
  stripeSetupAvailable,
  stripeChargeAvailable,
  activeConsentVersion,
}: BookingPaymentClientProps) {
  // One token per visit to this page — resent unchanged on every retry of
  // the same submission (double click, slow network) so the server can
  // never create two booking orders for one submission. A genuinely
  // different selection gets a fresh token by revisiting/reloading this
  // page. See booking_orders.client_request_id.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  const [normalFrequency, setNormalFrequency] = useState<FrequencyId>(defaultFrequency);
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedStartTime, setRequestedStartTime] = useState("");
  const [normalSubmitting, setNormalSubmitting] = useState(false);
  const [normalErrors, setNormalErrors] = useState<string[] | null>(null);
  // The ONE required checkbox for this panel — represents the customer's
  // combined acceptance of Service Terms, the Cancellation/Rescheduling
  // Policy, AND payment-method-save authorization together. It drives both
  // paymentMethodSaveAuthorized and consentAccepted server-side (two named
  // fields for two audit-relevant facts), never two separate checkboxes.
  const [normalConsentChecked, setNormalConsentChecked] = useState(false);
  const [normalConsentInvalid, setNormalConsentInvalid] = useState(false);
  const [normalTermsOpen, setNormalTermsOpen] = useState(false);

  const [activePackageTab, setActivePackageTab] = useState<PrepaidFrequency>("weekly");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>(null);
  const [packageSubmitting, setPackageSubmitting] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [packageConsentChecked, setPackageConsentChecked] = useState(false);
  const [packageConsentInvalid, setPackageConsentInvalid] = useState(false);
  const [packageTermsOpen, setPackageTermsOpen] = useState(false);

  // Mutable so a version-race response (the terms changed between page
  // load and submission) can swap in the now-current version for the
  // customer to review, rather than silently signing the stale one they
  // never actually saw. See createNormalBookingCheckout's "consent_changed" stage.
  const [consentVersion, setConsentVersion] = useState(activeConsentVersion);

  const selectedNormalOption = normalOptions[normalFrequency];
  const selectedFutureOption = isRecurring(normalFrequency) ? futureRecurringOptions[normalFrequency] : null;

  function handleConsentVersionChanged(currentVersion: ConsentVersionSummary, resetChecked: (checked: boolean) => void) {
    setConsentVersion(currentVersion);
    resetChecked(false);
    return [
      "Our terms were just updated. Please review the current Terms & Consent and check the box again before continuing.",
    ];
  }

  async function handleNormalSubmit() {
    if (normalSubmitting) return;
    setNormalErrors(null);
    setNormalConsentInvalid(false);

    if (!requestedDate) {
      setNormalErrors(["Please choose a preferred date."]);
      return;
    }
    if (!requestedStartTime) {
      setNormalErrors(["Please choose a preferred start time."]);
      return;
    }
    if (!consentVersion) {
      setNormalErrors([GENERIC_ERROR_MESSAGE]);
      return;
    }
    if (!normalConsentChecked) {
      setNormalConsentInvalid(true);
      setNormalErrors(["Please agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization to continue."]);
      return;
    }

    setNormalSubmitting(true);
    try {
      const result = await createNormalBookingCheckout({
        quoteId,
        clientRequestId,
        frequency: normalFrequency,
        requestedDate,
        requestedStartTime,
        addOnIds: selection.addOnIds,
        specialRooms: selection.specialRooms,
        movePackageLevel: selection.movePackageLevel,
        outdoorSelection: selection.outdoorSelection,
        quantifiedAddOns: selection.quantifiedAddOns,
        paymentMethodSaveAuthorized: normalConsentChecked,
        consentAccepted: normalConsentChecked,
        presentedConsentVersionId: consentVersion.id,
      });
      // A successful call redirects server-side and never returns here.
      if (result.stage === "validation") {
        setNormalErrors(result.errors);
      } else if (result.stage === "consent_changed") {
        setNormalErrors(handleConsentVersionChanged(result.currentVersion, setNormalConsentChecked));
      } else {
        setNormalErrors([GENERIC_ERROR_MESSAGE]);
      }
    } catch {
      setNormalErrors([GENERIC_ERROR_MESSAGE]);
    } finally {
      setNormalSubmitting(false);
    }
  }

  async function handlePackageSubmit() {
    if (packageSubmitting || !selectedPaymentMethod) return;
    setPackageError(null);
    setPackageConsentInvalid(false);

    if (!consentVersion) {
      setPackageError(GENERIC_ERROR_MESSAGE);
      return;
    }
    if (!packageConsentChecked) {
      setPackageConsentInvalid(true);
      setPackageError("Please agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization to continue.");
      return;
    }

    setPackageSubmitting(true);
    try {
      const result = await createPrepaidPackageCheckout({
        quoteId,
        clientRequestId,
        frequency: activePackageTab,
        paymentMethod: selectedPaymentMethod,
        consentAccepted: packageConsentChecked,
        presentedConsentVersionId: consentVersion.id,
      });
      if (result.stage === "manual_review_required") {
        setPackageError(
          `This package needs a quick manual review. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`
        );
      } else if (result.stage === "consent_changed") {
        setPackageError(handleConsentVersionChanged(result.currentVersion, setPackageConsentChecked)[0]);
      } else if (result.stage === "validation") {
        setPackageError(result.errors[0] ?? GENERIC_ERROR_MESSAGE);
      } else {
        setPackageError(GENERIC_ERROR_MESSAGE);
      }
    } catch {
      setPackageError(GENERIC_ERROR_MESSAGE);
    } finally {
      setPackageSubmitting(false);
    }
  }

  const activePackage = packageOptions[activePackageTab];
  const activeAchPackage = achPackageOptions[activePackageTab];
  const cardBuyable =
    stripeChargeAvailable &&
    !activePackage.manualReviewRequired &&
    activePackage.prepaidPackageTotal !== null &&
    activePackage.effectivePricePerVisit !== null;
  const showingAch = selectedPaymentMethod === "us_bank_account" && activeAchPackage !== null;
  const displayedTotal = showingAch ? (activeAchPackage as AchPackagePricing).achSubtotal : (activePackage.prepaidPackageTotal as number);
  const displayedPerVisit = showingAch
    ? (activeAchPackage as AchPackagePricing).achEffectivePricePerVisit
    : (activePackage.effectivePricePerVisit as number);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium text-muted">CleanPerfecto</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Booking &amp; Payment</h1>
      </div>

      {/* A. Pay Per Cleaning */}
      <GlassPanel className="p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">Pay Per Cleaning</h2>
        <p className="mt-1 text-sm text-muted">Choose a frequency, then request your preferred date and start time.</p>

        <div className="mt-5">
          <p className="mb-2.5 text-sm font-medium text-foreground">Frequency</p>
          <div role="group" aria-label="Frequency" className="flex flex-wrap gap-2">
            {NORMAL_FREQUENCIES.map((frequency) => {
              const isSelected = frequency === normalFrequency;
              return (
                <button
                  key={frequency}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setNormalFrequency(frequency)}
                  className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    isSelected
                      ? "border-secondary bg-secondary text-foreground"
                      : "border-border bg-white text-muted hover:border-secondary/50 hover:text-foreground"
                  }`}
                >
                  {NORMAL_FREQUENCY_LABELS[frequency]}
                </button>
              );
            })}
          </div>
        </div>

        {selectedNormalOption && (
          <div className="mt-5 rounded-2xl bg-background-alt p-4">
            <p className="text-xs font-medium text-muted">First Cleaning</p>
            {selectedNormalOption.manualReviewRequired || selectedNormalOption.range === null ? (
              <p className="text-sm text-muted">Final pricing for this option requires a quick confirmation from our team.</p>
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {selectedNormalOption.hasStartingAtPricing ? "Estimated price " : ""}
                {`$${resolveCustomerBookingPrice(selectedNormalOption)}`}
              </p>
            )}
            {selectedNormalOption.minimumServiceTotalApplied && (
              <p className="mt-1 text-xs text-muted">*$99 minimum service total applies.</p>
            )}

            {selectedFutureOption && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted">
                  Future {NORMAL_FREQUENCY_LABELS[normalFrequency]} Cleanings
                </p>
                {selectedFutureOption.range === null ? (
                  <p className="text-sm text-muted">Requires a quick confirmation from our team.</p>
                ) : (
                  <p className="text-lg font-semibold text-foreground">
                    {selectedFutureOption.hasStartingAtPricing ? "Estimated price " : ""}
                    {`$${resolveCustomerBookingPrice(selectedFutureOption)}`}{" "}
                    <span className="text-sm font-normal text-muted">per visit</span>
                  </p>
                )}
              </div>
            )}

            {!selectedNormalOption.manualReviewRequired &&
              selectedNormalOption.range !== null &&
              extrasSummary(selectedNormalOption).length > 0 && (
                <p className="mt-2 text-xs text-muted">Extras: {extrasSummary(selectedNormalOption).join(", ")}</p>
              )}
          </div>
        )}

        {!stripeSetupAvailable ? (
          <div className="mt-6 rounded-2xl border border-border bg-background-alt p-4 text-sm text-muted">
            Online booking is temporarily unavailable. Please contact CleanPerfecto at {SITE_CONTACT.phoneDisplay} to
            schedule.
          </div>
        ) : (
        <>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="booking-date" className="mb-2 block text-sm font-medium text-foreground">
              Preferred date
            </label>
            <input
              id="booking-date"
              type="date"
              min={todayIsoDate()}
              value={requestedDate}
              onChange={(event) => setRequestedDate(event.target.value)}
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="booking-start-time" className="mb-2 block text-sm font-medium text-foreground">
              Preferred start time
            </label>
            <input
              id="booking-start-time"
              type="time"
              min={OPERATING_HOURS_START}
              max={OPERATING_HOURS_END}
              step={1800}
              value={requestedStartTime}
              onChange={(event) => setRequestedStartTime(event.target.value)}
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-muted">Subject to confirmation, 8:00 AM–5:00 PM, in 30-minute increments.</p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-foreground">Secure your booking</p>
          <p className="mt-1 text-sm text-muted">
            Save a payment method today. You won&apos;t be charged now. We&apos;ll confirm your exact price and
            appointment before your cleaning.
          </p>
        </div>

        <RequiredConsentCheckbox
          id="normal-consent-checkbox"
          checked={normalConsentChecked}
          onChange={setNormalConsentChecked}
          onViewTerms={() => setNormalTermsOpen(true)}
          showValidationError={normalConsentInvalid}
        />
        {consentVersion && (
          <TermsConsentDialog
            open={normalTermsOpen}
            onClose={() => setNormalTermsOpen(false)}
            serviceTermsTitle={consentVersion.title}
            serviceTermsBody={consentVersion.bodyText}
            isLegallyReviewed={consentVersion.isLegallyReviewed}
            cancellationPolicyTiers={CANCELLATION_POLICY_TIERS}
            feeReplacementNote={NO_ACCESS_FEE_REPLACEMENT_NOTE}
            paymentAuthorizationCopy={SAVED_PAYMENT_AUTHORIZATION_COPY}
          />
        )}

        {normalErrors && (
          <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <ul className="list-inside list-disc">
              {normalErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={handleNormalSubmit}
          disabled={normalSubmitting}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60 sm:w-auto"
        >
          {normalSubmitting ? "Please wait…" : "Secure My Booking"}
        </button>
        </>
        )}
      </GlassPanel>

      {/* B. Prepay 6 Cleanings & Save an Extra 10% */}
      <GlassPanel className="p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">Prepay 6 Cleanings &amp; Save an Extra 10%</h2>
        <p className="mt-1 text-sm text-muted">6 cleanings included. Pay in full today. Schedule your cleaning dates later.</p>

        <div role="group" aria-label="Package frequency" className="mt-5 flex flex-wrap gap-2">
          {PACKAGE_FREQUENCIES.map((frequency) => {
            const isSelected = frequency === activePackageTab;
            return (
              <button
                key={frequency}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setActivePackageTab(frequency);
                  setPackageError(null);
                }}
                className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  isSelected
                    ? "border-secondary bg-secondary text-foreground"
                    : "border-border bg-white text-muted hover:border-secondary/50 hover:text-foreground"
                }`}
              >
                {PREPAID_FREQUENCY_LABELS[frequency]}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl bg-background-alt p-5">
          {cardBuyable ? (
            <>
              <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {formatMoney(displayedPerVisit)} per cleaning
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(displayedTotal)} total</p>
              <p className="mt-2 text-xs text-muted">Taxes calculated at checkout.</p>
              <p className="mt-3 text-sm font-medium text-primary">Extra 10% prepaid savings applied</p>
              {showingAch && <p className="mt-1 text-sm font-medium text-primary">Extra 1% bank-payment savings applied</p>}
              <p className="mt-3 text-xs text-muted">
                *Based on your current cleaning details and agreed scope. Add-ons or material scope changes are separate.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              This package needs a quick confirmation from our team — please contact CleanPerfecto at{" "}
              {SITE_CONTACT.phoneDisplay}.
            </p>
          )}
        </div>

        {cardBuyable && (
          <div className="mt-6">
            <p className="text-sm font-medium text-foreground">Payment method</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={selectedPaymentMethod === "us_bank_account"}
                onClick={() => setSelectedPaymentMethod("us_bank_account")}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  selectedPaymentMethod === "us_bank_account"
                    ? "border-secondary bg-secondary/10"
                    : "border-border bg-white hover:border-secondary/50"
                }`}
              >
                <p className="text-sm font-semibold text-foreground">Bank Account (ACH)</p>
                <p className="text-xs font-medium text-primary">Best Value</p>
                <p className="mt-1 text-xs text-muted">Save an extra 1%</p>
              </button>
              <button
                type="button"
                aria-pressed={selectedPaymentMethod === "card"}
                onClick={() => setSelectedPaymentMethod("card")}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  selectedPaymentMethod === "card"
                    ? "border-secondary bg-secondary/10"
                    : "border-border bg-white hover:border-secondary/50"
                }`}
              >
                <p className="text-sm font-semibold text-foreground">Credit / Debit Card</p>
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-muted">{PREPAID_PACKAGE_CANCELLATION_NOTE}</p>

        {cardBuyable && (
          <>
            <RequiredConsentCheckbox
              id="package-consent-checkbox"
              checked={packageConsentChecked}
              onChange={setPackageConsentChecked}
              onViewTerms={() => setPackageTermsOpen(true)}
              showValidationError={packageConsentInvalid}
            />
            {consentVersion && (
              <TermsConsentDialog
                open={packageTermsOpen}
                onClose={() => setPackageTermsOpen(false)}
                serviceTermsTitle={consentVersion.title}
                serviceTermsBody={consentVersion.bodyText}
                isLegallyReviewed={consentVersion.isLegallyReviewed}
                cancellationPolicyTiers={CANCELLATION_POLICY_TIERS}
                feeReplacementNote={NO_ACCESS_FEE_REPLACEMENT_NOTE}
                packageCancellationNote={PREPAID_PACKAGE_CANCELLATION_NOTE}
                paymentAuthorizationCopy={PREPAID_PAYMENT_AUTHORIZATION_COPY}
              />
            )}
          </>
        )}

        {packageError && (
          <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {packageError}
          </div>
        )}

        <button
          type="button"
          onClick={handlePackageSubmit}
          disabled={packageSubmitting || !cardBuyable || !selectedPaymentMethod}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60 sm:w-auto"
        >
          {packageSubmitting ? "Please wait…" : `Purchase ${PREPAID_FREQUENCY_LABELS[activePackageTab]} Package`}
        </button>
      </GlassPanel>
    </div>
  );
}
