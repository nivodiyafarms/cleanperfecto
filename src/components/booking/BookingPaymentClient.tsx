"use client";

import { useMemo, useState } from "react";
import { createNormalBookingCheckout } from "@/lib/booking/create-normal-booking-checkout";
import { createPrepaidPackageCheckout } from "@/lib/booking/create-prepaid-package-checkout";
import { CANCELLATION_POLICY_TIERS, PREPAID_PACKAGE_CANCELLATION_NOTE, SAVED_PAYMENT_AUTHORIZATION_COPY } from "@/lib/booking/cancellation-policy";
import type { AchPackagePricing } from "@/lib/booking/ach-package-options";
import { NORMAL_FREQUENCY_LABELS, PREPAID_FREQUENCY_LABELS } from "@/lib/booking/labels";
import { OPERATING_HOURS_END, OPERATING_HOURS_START } from "@/lib/booking/operating-hours";
import type { BookingPricingOptions, PaymentMethodType, PrepaidFrequency } from "@/lib/booking/types";
import type { CalculationResult, FrequencyId } from "@/lib/pricing/types";
import { SITE_CONTACT } from "@/lib/site-contact";
import type { AddOnSelection } from "@/components/quote-wizard/map-form-to-raw-input";
import GlassPanel from "@/components/ui/GlassPanel";

const NORMAL_FREQUENCIES: FrequencyId[] = ["one_time", "weekly", "biweekly", "every_4_weeks"];
const PACKAGE_FREQUENCIES: PrepaidFrequency[] = ["weekly", "biweekly", "every_4_weeks"];

const GENERIC_ERROR_MESSAGE = `Something went wrong. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;

function formatRange(lower: number, upper: number): string {
  return `$${lower}–$${upper}`;
}

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
}

/** Collapsed by default — the customer must still be able to open and review this before accepting the authorization checkbox below it. */
function CancellationPolicyDisclosure() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3">
      <p className="text-xs text-muted">Free changes 48+ hours before your appointment.</p>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="mt-1 text-xs font-medium text-secondary underline decoration-secondary/40 underline-offset-2"
      >
        {expanded ? "Hide cancellation & rescheduling policy" : "View cancellation & rescheduling policy"}
      </button>
      {expanded && (
        <ul className="mt-2 flex flex-col gap-1 rounded-2xl bg-background-alt p-3 text-xs text-muted">
          {CANCELLATION_POLICY_TIERS.map((tier) => (
            <li key={tier.window}>
              <span className="text-foreground">{tier.window}:</span> {tier.fee}
            </li>
          ))}
        </ul>
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
  const [authorized, setAuthorized] = useState(false);
  const [normalSubmitting, setNormalSubmitting] = useState(false);
  const [normalErrors, setNormalErrors] = useState<string[] | null>(null);

  const [activePackageTab, setActivePackageTab] = useState<PrepaidFrequency>("weekly");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>(null);
  const [packageSubmitting, setPackageSubmitting] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  const selectedNormalOption = normalOptions[normalFrequency];
  const selectedFutureOption = isRecurring(normalFrequency) ? futureRecurringOptions[normalFrequency] : null;

  async function handleNormalSubmit() {
    if (normalSubmitting) return;
    setNormalErrors(null);

    if (!requestedDate) {
      setNormalErrors(["Please choose a preferred date."]);
      return;
    }
    if (!requestedStartTime) {
      setNormalErrors(["Please choose a preferred start time."]);
      return;
    }
    if (!authorized) {
      setNormalErrors([
        "Please authorize CleanPerfecto to securely save your payment method and accept the cancellation/rescheduling policy to continue.",
      ]);
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
        paymentMethodSaveAuthorized: authorized,
      });
      // A successful call redirects server-side and never returns here.
      if (result.stage === "validation") {
        setNormalErrors(result.errors);
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
    setPackageSubmitting(true);
    try {
      const result = await createPrepaidPackageCheckout({
        quoteId,
        clientRequestId,
        frequency: activePackageTab,
        paymentMethod: selectedPaymentMethod,
      });
      if (result.stage === "manual_review_required") {
        setPackageError(
          `This package needs a quick manual review. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`
        );
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
                {selectedNormalOption.hasStartingAtPricing ? "Starting at " : ""}
                {formatRange(selectedNormalOption.range.lower, selectedNormalOption.range.upper)}
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
                    {selectedFutureOption.hasStartingAtPricing ? "Starting at " : ""}
                    {formatRange(selectedFutureOption.range.lower, selectedFutureOption.range.upper)}{" "}
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
              value={requestedStartTime}
              onChange={(event) => setRequestedStartTime(event.target.value)}
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-muted">Subject to confirmation, 8:00 AM–6:00 PM.</p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-foreground">Secure your booking</p>
          <p className="mt-1 text-sm text-muted">
            Save a payment method today. You won&apos;t be charged now. We&apos;ll confirm your exact price and
            appointment before your cleaning.
          </p>
        </div>

        <label className="mt-4 flex items-start gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(event) => setAuthorized(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-secondary focus:ring-primary/50"
          />
          <span>{SAVED_PAYMENT_AUTHORIZATION_COPY}</span>
        </label>

        <CancellationPolicyDisclosure />

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
                {formatMoney(displayedTotal)} total
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(displayedPerVisit)} per cleaning</p>
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
