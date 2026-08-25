"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  confirmVisitPaymentAction,
  createPaymentMethodSetupUrlAction,
  getVisitPaymentReviewAction,
  getVisitPaymentStatusAction,
  selectVisitTipAction,
  type CustomerVisitPaymentStatus,
} from "@/lib/customer-portal/actions/payment-actions";
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

type Step = "loading" | "review" | "tip" | "confirm" | "result" | "error";

const TIP_OPTIONS: { type: TipSelectionType; label: string }[] = [
  { type: "percentage_15", label: "15%" },
  { type: "percentage_20", label: "20%" },
  { type: "percentage_25", label: "25%" },
  { type: "custom", label: "Custom" },
];

export default function VisitPaymentFlow({ serviceVisitId }: { serviceVisitId: string }) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ approvedAmount: number; tipBasisAmount: number; previewTaxAmount: number; previewAmountDueBeforeTip: number } | null>(null);
  const [selectedTip, setSelectedTip] = useState<TipSelectionType | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [confirmed, setConfirmed] = useState<{ approvedAmount: number; tipAmount: number; taxAmount: number; totalAmount: number } | null>(null);
  const [result, setResult] = useState<CustomerVisitPaymentStatus | null>(null);
  const [processing, setProcessing] = useState(false);
  const [needsPaymentMethod, setNeedsPaymentMethod] = useState(false);

  useEffect(() => {
    void (async () => {
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
      const reviewResult = await getVisitPaymentReviewAction(serviceVisitId);
      if (!reviewResult.ok) {
        setError(reviewResult.error);
        setStep("error");
        return;
      }
      setReview(reviewResult.data);
      setStep("review");
    })();
  }, [serviceVisitId]);

  async function handleSelectTip(type: TipSelectionType) {
    if (type === "custom") {
      setSelectedTip(type);
      return;
    }
    setProcessing(true);
    setError(null);
    const outcome = await selectVisitTipAction(serviceVisitId, type);
    setProcessing(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setSelectedTip(type);
    setConfirmed({ approvedAmount: outcome.data.approvedAmount, tipAmount: outcome.data.tipAmount, taxAmount: outcome.data.taxAmount, totalAmount: outcome.data.totalAmount });
    setStep("confirm");
  }

  async function handleSubmitCustomTip() {
    const amount = Number(customAmount);
    if (Number.isNaN(amount)) {
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
    setConfirmed({ approvedAmount: outcome.data.approvedAmount, tipAmount: outcome.data.tipAmount, taxAmount: outcome.data.taxAmount, totalAmount: outcome.data.totalAmount });
    setStep("confirm");
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

    if (outcome.data.outcome === "no_payment_due") {
      setProcessing(false);
      setResult({ status: "no_payment_due", approvedAmount: confirmed?.approvedAmount ?? 0, tipAmount: confirmed?.tipAmount ?? 0, taxAmount: confirmed?.taxAmount ?? 0, totalAmount: 0, paidAt: null, refundedAmount: 0, needsClientConfirmation: false });
      setStep("result");
      return;
    }
    if (outcome.data.outcome === "needs_payment_method") {
      setProcessing(false);
      setNeedsPaymentMethod(true);
      return;
    }
    if (outcome.data.outcome === "refreshed") {
      setProcessing(false);
      setConfirmed({ approvedAmount: outcome.data.approvedAmount, tipAmount: outcome.data.tipAmount, taxAmount: outcome.data.taxAmount, totalAmount: outcome.data.totalAmount });
      setError("Your total was refreshed. Please review and confirm again.");
      return;
    }

    // outcome === "ready"
    if (!outcome.data.clientSecret) {
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
    const confirmResult = await stripe.confirmCardPayment(outcome.data.clientSecret);
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

  if (step === "review" && review) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Review Charges</h3>
        <dl className="space-y-1 text-sm text-foreground">
          <div>Cleaning &amp; extras: {formatMoney(review.approvedAmount)}</div>
          <div>Tax (estimated): {formatMoney(review.previewTaxAmount)}</div>
          <div className="font-semibold">Amount due before tip: {formatMoney(review.previewAmountDueBeforeTip)}</div>
        </dl>
        <button onClick={() => setStep("tip")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          Continue
        </button>
      </div>
    );
  }

  if (step === "tip") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Add a tip for your cleaning team</h3>
        <div className="flex flex-wrap gap-2">
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="w-32 rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
            <button onClick={handleSubmitCustomTip} disabled={processing} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {processing ? "Working…" : "Continue"}
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (step === "confirm" && confirmed) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Confirm &amp; Pay</h3>
        <dl className="space-y-1 text-sm text-foreground">
          <div>Cleaning &amp; extras: {formatMoney(confirmed.approvedAmount)}</div>
          <div>Tax: {formatMoney(confirmed.taxAmount)}</div>
          <div>Tip: {formatMoney(confirmed.tipAmount)}</div>
          <div className="font-semibold">Total: {formatMoney(confirmed.totalAmount)}</div>
        </dl>
        {needsPaymentMethod ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">No saved payment method on file.</p>
            <button onClick={handleAddPaymentMethod} disabled={processing} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt disabled:opacity-50">
              Add payment method
            </button>
          </div>
        ) : (
          <button onClick={handleConfirmAndPay} disabled={processing} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {processing ? "Working…" : `Pay ${formatMoney(confirmed.totalAmount)}`}
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return null;
}
