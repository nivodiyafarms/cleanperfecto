"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  confirmFinalTotalAndPayAction,
  confirmVisitPaymentAction,
  createPaymentMethodSetupUrlAction,
  getVisitPaymentReviewAction,
  getVisitPaymentStatusAction,
  getVisitPricingStateAction,
  selectVisitTipAction,
  type CustomerVisitPaymentStatus,
  type VisitPricingApprovalState,
} from "@/lib/customer-portal/actions/payment-actions";
import type { CreateVisitPaymentIntentOutcome } from "@/lib/payments/create-visit-payment-intent";
import type { TipSelectionType } from "@/lib/scheduling/types";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

type Step = "loading" | "increase_pending" | "increase_awaiting_completion" | "increase_blocked" | "final_total" | "confirm" | "result" | "error";

const TIP_OPTIONS: { type: TipSelectionType; label: string }[] = [
  { type: "percentage_15", label: "15%" },
  { type: "percentage_20", label: "20%" },
  { type: "percentage_25", label: "25%" },
  { type: "custom", label: "Custom" },
];

interface VisitPaymentFlowProps {
  serviceVisitId: string;
  /** Server-computed via canCreateStripeCharge() — see the page component. When false, the interactive final-total flow is replaced with a message rather than inviting a card charge that would only fail server-side. Historical/no_payment_due results still display regardless — this only gates NEW charge attempts. */
  stripeChargesAvailable: boolean;
}

/**
 * The customer's entire "review your final total, pick a tip, and pay"
 * interaction lives on this ONE screen with ONE confirmation click
 * ("Confirm Final Total & Pay") — no separate Review/Tip/Confirm pages, and
 * no separate "approve this price increase" page either. Picking a tip
 * amount is an input, not a confirmation, so it updates the total in place
 * without leaving this screen.
 *
 * A pending price increase is resolved by the customer's OWN click — see
 * confirmFinalTotalAndPay — with no separate admin-mediated round trip. It
 * can only be resolved (and paid) once the visit has completed; before
 * that there is nothing chargeable yet, so this screen shows only the
 * old/new amounts and a single "Approve" action (no tip/tax section, since
 * there's no total to compute).
 */
export default function VisitPaymentFlow({ serviceVisitId, stripeChargesAvailable }: VisitPaymentFlowProps) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pricingState, setPricingState] = useState<VisitPricingApprovalState | null>(null);
  const [review, setReview] = useState<{ approvedAmount: number; tipBasisAmount: number; previewTaxAmount: number; previewAmountDueBeforeTip: number } | null>(null);
  const [selectedTip, setSelectedTip] = useState<TipSelectionType | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [totals, setTotals] = useState<{ tipAmount: number; taxAmount: number; totalAmount: number } | null>(null);
  const [result, setResult] = useState<CustomerVisitPaymentStatus | null>(null);
  const [processing, setProcessing] = useState(false);
  const [needsPaymentMethod, setNeedsPaymentMethod] = useState(false);

  async function load() {
    const statusResult = await getVisitPaymentStatusAction(serviceVisitId);
    if (!statusResult.ok) {
      setError(statusResult.error);
      setStep("error");
      return;
    }
    const status = statusResult.data;
    if (status && status.status !== "created") {
      setResult(status);
      setStep(status.needsClientConfirmation ? "confirm" : "result");
      return;
    }

    const pricingResult = await getVisitPricingStateAction(serviceVisitId);
    if (!pricingResult.ok) {
      setError(pricingResult.error);
      setStep("error");
      return;
    }
    setPricingState(pricingResult.data);
    if (pricingResult.data.requiresCustomerApproval) {
      // A pending increase can only be resolved into a payable total once
      // the visit has completed — see confirm-final-total-and-pay.ts for
      // why (the pricing/status columns freeze at that point).
      setStep(pricingResult.data.visitCompleted ? "increase_blocked" : "increase_pending");
      return;
    }

    const reviewResult = await getVisitPaymentReviewAction(serviceVisitId);
    if (!reviewResult.ok) {
      setError(reviewResult.error);
      setStep("error");
      return;
    }
    setReview(reviewResult.data);
    setStep("final_total");
  }

  useEffect(() => {
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceVisitId]);

  async function handleApproveIncrease() {
    setProcessing(true);
    setError(null);
    const outcome = await confirmFinalTotalAndPayAction(serviceVisitId);
    setProcessing(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    if (outcome.data.outcome === "approved_awaiting_completion") {
      setStep("increase_awaiting_completion");
      return;
    }
    // The visit was already completed by the time this resolved (e.g. a
    // concurrent admin update) — re-load to pick up the now-payable screen.
    setStep("loading");
    void load();
  }

  async function applyTip(type: TipSelectionType, amount?: number) {
    setProcessing(true);
    setError(null);
    const outcome = await selectVisitTipAction(serviceVisitId, type, amount);
    setProcessing(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return false;
    }
    setTotals({ tipAmount: outcome.data.tipAmount, taxAmount: outcome.data.taxAmount, totalAmount: outcome.data.totalAmount });
    return true;
  }

  async function handleSelectTip(type: TipSelectionType) {
    if (type === "custom") {
      setSelectedTip(type);
      return;
    }
    const ok = await applyTip(type);
    if (ok) setSelectedTip(type);
  }

  async function handleSubmitCustomTip() {
    const amount = Number(customAmount);
    if (Number.isNaN(amount) || amount < 0) {
      setError("Please enter a valid tip amount.");
      return;
    }
    setProcessing(true);
    setError(null);
    const outcome = await selectVisitTipAction(serviceVisitId, "custom", amount);
    setProcessing(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    if (outcome.data.requiresConfirmation) {
      const ok = window.confirm(`Please confirm that you want to leave a ${formatMoney(amount)} tip.`);
      if (!ok) return;
    }
    setTotals({ tipAmount: outcome.data.tipAmount, taxAmount: outcome.data.taxAmount, totalAmount: outcome.data.totalAmount });
    setSelectedTip("custom");
  }

  async function handleConfirmAndPay() {
    setProcessing(true);
    setError(null);
    setNeedsPaymentMethod(false);
    const outcome = await confirmVisitPaymentAction(serviceVisitId);
    if (!outcome.ok) {
      setProcessing(false);
      setError(outcome.error);
      return;
    }
    await processPaymentOutcome(outcome.data);
  }

  async function processPaymentOutcome(data: CreateVisitPaymentIntentOutcome) {
    if (data.outcome === "no_payment_due") {
      setProcessing(false);
      setResult({ status: "no_payment_due", approvedAmount: review?.approvedAmount ?? 0, tipAmount: totals?.tipAmount ?? 0, taxAmount: totals?.taxAmount ?? 0, totalAmount: 0, paidAt: null, refundedAmount: 0, needsClientConfirmation: false });
      setStep("result");
      return;
    }
    if (data.outcome === "needs_payment_method") {
      setProcessing(false);
      setNeedsPaymentMethod(true);
      return;
    }
    if (data.outcome === "refreshed") {
      setProcessing(false);
      setTotals({ tipAmount: data.tipAmount, taxAmount: data.taxAmount, totalAmount: data.totalAmount });
      setError("Your total was refreshed — please review the updated amount and confirm again.");
      return;
    }

    // outcome === "ready"
    if (!data.clientSecret) {
      setProcessing(false);
      setError("Payment could not be started. Please try again.");
      return;
    }
    const stripe = await getStripe();
    if (!stripe) {
      setProcessing(false);
      setError("Payment is not configured. Please try again later.");
      return;
    }
    const confirmResult = await stripe.confirmCardPayment(data.clientSecret);
    setProcessing(false);
    if (confirmResult.error) {
      setError(confirmResult.error.message ?? "Payment could not be completed.");
    }
    // Webhook is authoritative — re-check status regardless of the client result.
    const statusResult = await getVisitPaymentStatusAction(serviceVisitId);
    if (statusResult.ok && statusResult.data) {
      setResult(statusResult.data);
      setStep(statusResult.data.needsClientConfirmation ? "confirm" : "result");
    }
  }

  async function handleAddPaymentMethod() {
    setProcessing(true);
    const outcome = await createPaymentMethodSetupUrlAction(serviceVisitId);
    setProcessing(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    window.location.href = outcome.data.url;
  }

  if (step === "loading") return <p className="text-sm text-muted">Loading…</p>;
  if (step === "error") return <p className="text-sm text-red-600">{error}</p>;

  if (step === "result") {
    const r = result!;
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-emerald-700">{r.status === "no_payment_due" ? "No payment due" : "Paid"}</p>
        <dl className="mt-3 space-y-1 text-sm text-foreground">
          <div>Service: {formatMoney(r.approvedAmount)}</div>
          <div>Tax: {formatMoney(r.taxAmount ?? 0)}</div>
          <div>Tip: {formatMoney(r.tipAmount ?? 0)}</div>
          <div className="font-semibold">Total: {formatMoney(r.totalAmount ?? 0)}</div>
          {r.paidAt && <div className="text-xs text-muted">Paid date: {new Date(r.paidAt).toLocaleDateString()}</div>}
          {r.refundedAmount > 0 && <div className="text-xs text-amber-700">Refunded: {formatMoney(r.refundedAmount)}</div>}
        </dl>
      </div>
    );
  }

  if (step === "confirm" && result?.needsClientConfirmation) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <p className="text-sm font-medium text-amber-800">Payment needs your attention</p>
        <p className="mt-1 text-sm text-amber-800">Your bank requires additional verification to complete this payment.</p>
        <button onClick={handleConfirmAndPay} disabled={processing} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {processing ? "Working…" : "Complete payment"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (step === "increase_pending" && pricingState) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-amber-900">Your price changed and needs your approval</h3>
        <dl className="space-y-1 text-sm text-amber-900">
          {pricingState.previouslyApprovedAmount !== null && <div>Previously approved: {formatMoney(pricingState.previouslyApprovedAmount)}</div>}
          <div className="font-semibold">Updated finalized amount: {formatMoney(pricingState.totalAmount ?? 0)}</div>
        </dl>
        <p className="text-xs text-amber-800">This usually reflects an added service or extra. Payment (tax and tip) will be available once your cleaning is complete.</p>
        <button onClick={handleApproveIncrease} disabled={processing} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {processing ? "Working…" : `Approve final price of ${formatMoney(pricingState.totalAmount ?? 0)}`}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (step === "increase_awaiting_completion") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Thanks — approved</p>
        <p className="mt-1 text-sm text-muted">Once your cleaning is marked complete, you can review your final total (including tax and tip) and pay right here.</p>
      </div>
    );
  }

  if (step === "increase_blocked" && pricingState) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 space-y-2">
        <h3 className="text-sm font-semibold text-amber-900">This visit&apos;s price needs to be finalized</h3>
        <p className="text-sm text-amber-800">
          Updated amount: {formatMoney(pricingState.totalAmount ?? 0)}. Please contact CleanPerfecto so we can finalize this before you pay.
        </p>
      </div>
    );
  }

  if (!stripeChargesAvailable && step === "final_total") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Online payment is temporarily unavailable</p>
        <p className="mt-1 text-sm text-muted">Please contact CleanPerfecto to arrange payment for this cleaning.</p>
      </div>
    );
  }

  if (step === "final_total" && review) {
    const displayTax = totals?.taxAmount ?? review.previewTaxAmount;
    const displayTotal = totals?.totalAmount ?? review.previewAmountDueBeforeTip;
    const displayTip = totals?.tipAmount ?? 0;

    return (
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Your Final Total</h3>
        <dl className="space-y-1 text-sm text-foreground">
          <div>Cleaning &amp; extras: {formatMoney(review.approvedAmount)}</div>
          <div>Tax{totals ? "" : " (estimated)"}: {formatMoney(displayTax)}</div>
          <div>Tip: {formatMoney(displayTip)}</div>
          <div className="font-semibold text-base">Total: {formatMoney(displayTotal)}</div>
        </dl>

        <div>
          <p className="text-sm font-medium text-foreground">Add a tip for your cleaning team</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIP_OPTIONS.map((option) => (
              <button
                key={option.type}
                onClick={() => handleSelectTip(option.type)}
                disabled={processing}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${selectedTip === option.type ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-background-alt"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {selectedTip === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-foreground">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="w-32 rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
              />
              <button onClick={handleSubmitCustomTip} disabled={processing} className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-background-alt disabled:opacity-50">
                {processing ? "Working…" : "Apply"}
              </button>
            </div>
          )}
        </div>

        {needsPaymentMethod ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">No saved payment method on file.</p>
            <button onClick={handleAddPaymentMethod} disabled={processing} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt disabled:opacity-50">
              Add payment method
            </button>
          </div>
        ) : (
          <button
            onClick={handleConfirmAndPay}
            disabled={processing || !totals}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {processing ? "Working…" : totals ? `Confirm Final Total & Pay ${formatMoney(displayTotal)}` : "Select a tip to continue"}
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return null;
}
