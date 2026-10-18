"use client";

import { useActionState, useState } from "react";
import { acceptAgreedQuoteAction, type AcceptAgreedQuoteActionResult } from "@/lib/customer-portal/actions/agreed-quote-actions";
import {
  CANCELLATION_POLICY_TIERS,
  COMBINED_CONSENT_CHECKBOX_COPY,
  NO_ACCESS_FEE_REPLACEMENT_NOTE,
  PREPAID_PACKAGE_CANCELLATION_NOTE,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
} from "@/lib/booking/cancellation-policy";
import { OPERATING_HOURS_END, OPERATING_HOURS_START } from "@/lib/booking/operating-hours";
import type { ConsentVersionSummary } from "@/lib/booking/types";
import type { CalculationInput, CalculationResult } from "@/lib/pricing/types";
import TermsConsentDialog from "@/components/booking/TermsConsentDialog";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface AgreedQuoteAcceptanceClientProps {
  invitationId: string;
  calculationInput: CalculationInput;
  calculationResult: CalculationResult;
  cleaningType: "standard" | "deep" | "move";
  /** Pre-agreed by the admin — shown read-only, "requested," never a picker, when present. */
  agreedRequestedDate: string | null;
  agreedRequestedStartTime: string | null;
  activeConsentVersion: ConsentVersionSummary | null;
  /** Resume mode: the customer already started checkout — re-submits the same claim/accept flow, which converges on the same booking order/session rather than starting over. */
  resuming?: boolean;
}

export default function AgreedQuoteAcceptanceClient({
  invitationId,
  calculationInput,
  calculationResult,
  agreedRequestedDate,
  agreedRequestedStartTime,
  activeConsentVersion,
  resuming = false,
}: AgreedQuoteAcceptanceClientProps) {
  const [state, formAction, pending] = useActionState<AcceptAgreedQuoteActionResult | null, FormData>(acceptAgreedQuoteAction, null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [requestedDate, setRequestedDate] = useState(todayIsoDate());
  const [requestedStartTime, setRequestedStartTime] = useState(OPERATING_HOURS_START);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "us_bank_account">("card");
  const [showValidationError, setShowValidationError] = useState(false);

  const isPrepaidPackage = calculationInput.isPrepaidPackage;
  const needsDatePicker = !isPrepaidPackage && !agreedRequestedDate;
  const amountDueNowLabel = isPrepaidPackage ? formatMoney(calculationResult.prepaidPackageTotal ?? calculationResult.calculatedTotal) : "$0.00 — payment method saved only";

  const scopeAddOns = isPrepaidPackage ? calculationResult.packageManualQuoteAddOns : calculationResult.manualQuoteAddOns;

  function handleSubmit(formData: FormData) {
    if (!consentChecked || !activeConsentVersion) {
      setShowValidationError(true);
      return;
    }
    formData.set("invitationId", invitationId);
    formData.set("consentAccepted", "on");
    formData.set("presentedConsentVersionId", activeConsentVersion.id);
    if (needsDatePicker) {
      formData.set("requestedDate", requestedDate);
      formData.set("requestedStartTime", requestedStartTime);
    }
    if (isPrepaidPackage) {
      formData.set("paymentMethod", paymentMethod);
    }
    formAction(formData);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Your agreed offer</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {isPrepaidPackage ? (
            <>
              <div className="flex justify-between">
                <dt className="text-muted">Price per visit</dt>
                <dd className="text-foreground">{formatMoney(calculationResult.effectivePricePerVisit ?? 0)}</dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt className="text-foreground">Total for {calculationInput.visitCount} prepaid visits</dt>
                <dd className="text-foreground">{formatMoney(calculationResult.prepaidPackageTotal ?? 0)}</dd>
              </div>
            </>
          ) : (
            <div className="flex justify-between font-medium">
              <dt className="text-foreground">Agreed price</dt>
              <dd className="text-foreground">{formatMoney(calculationResult.calculatedTotal)}</dd>
            </div>
          )}
          {scopeAddOns.length > 0 && (
            <div>
              <dt className="text-muted">Included in this scope</dt>
              <dd className="text-foreground">{scopeAddOns.map((entry) => entry.label).join(", ")}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-xs text-muted">Sales tax, if applicable, is calculated during checkout.</p>
        <p className="mt-1 text-xs font-medium text-foreground">Amount due now: {amountDueNowLabel}</p>
      </section>

      {!isPrepaidPackage && (
        <section className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Visit date &amp; time</h2>
          {agreedRequestedDate ? (
            <p className="mt-2 text-sm text-foreground">
              Previously agreed visit: {agreedRequestedDate} at {agreedRequestedStartTime} — <span className="text-muted">requested, pending confirmation</span>
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} className="rounded-lg border border-border px-3 py-2 text-sm" />
              <input
                type="time"
                value={requestedStartTime}
                min={OPERATING_HOURS_START}
                max={OPERATING_HOURS_END}
                onChange={(e) => setRequestedStartTime(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
          )}
        </section>
      )}

      {isPrepaidPackage && (
        <section className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Payment method</h2>
          <div className="mt-3 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="paymentMethodChoice" checked={paymentMethod === "card"} onChange={() => setPaymentMethod("card")} />
              Card
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="paymentMethodChoice" checked={paymentMethod === "us_bank_account"} onChange={() => setPaymentMethod("us_bank_account")} />
              Bank account (ACH) — additional savings
            </label>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface p-6">
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-0.5" />
          {COMBINED_CONSENT_CHECKBOX_COPY}
        </label>
        <button type="button" onClick={() => setTermsOpen(true)} className="mt-2 text-xs text-secondary hover:underline">
          View Terms &amp; Consent
        </button>
        {showValidationError && !consentChecked && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            Please agree to the Service Terms, Cancellation &amp; Rescheduling Policy, and Payment Authorization to continue.
          </p>
        )}
      </section>

      {activeConsentVersion && (
        <TermsConsentDialog
          open={termsOpen}
          onClose={() => setTermsOpen(false)}
          serviceTermsTitle={activeConsentVersion.title}
          serviceTermsBody={activeConsentVersion.bodyText}
          isLegallyReviewed={activeConsentVersion.isLegallyReviewed}
          cancellationPolicyTiers={CANCELLATION_POLICY_TIERS}
          feeReplacementNote={NO_ACCESS_FEE_REPLACEMENT_NOTE}
          paymentAuthorizationCopy={isPrepaidPackage ? PREPAID_PAYMENT_AUTHORIZATION_COPY : SAVED_PAYMENT_AUTHORIZATION_COPY}
          packageCancellationNote={isPrepaidPackage ? PREPAID_PACKAGE_CANCELLATION_NOTE : undefined}
        />
      )}

      <form action={handleSubmit}>
        <button type="submit" disabled={pending} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {pending ? "Processing…" : resuming ? "Resume" : "Accept & Continue"}
        </button>
        {!pending && state && !state.ok && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}
