"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_CONTACT } from "@/lib/site-contact";
import { checkReferralCodeAction } from "@/lib/referrals/check-referral-code-action";
import type { ReferralCodeCheckResult } from "@/lib/referrals/check-referral-code-status";
import { createReferralCodeCheckTracker } from "@/lib/referrals/referral-code-feedback";
import { submitInstantQuoteRequest } from "@/lib/instant-quote/submit-instant-quote-request";
import type {
  InstantQuoteRequestAutomaticEstimate,
  InstantQuoteRequestManualReview,
} from "@/lib/instant-quote/instant-quote-request-result";
import { encodeCustomizationSelectionParams } from "@/lib/booking/customization-selection-params";
import CustomizeSection from "./CustomizeSection";
import EstimateResult from "./EstimateResult";
import { EMPTY_ADD_ON_SELECTION, mapWizardFormToRawInput, type AddOnSelection } from "./map-form-to-raw-input";
import { isStepOneValid, isStepTwoValid } from "./step-validation";
import StepOneCleaning from "./StepOneCleaning";
import StepTwoContact from "./StepTwoContact";
import { DEFAULT_WIZARD_FORM_STATE, type WizardFormState } from "./wizard-types";

type WizardPhase = "step1" | "step2" | "result";

type SubmitError = { stage: "validation"; errors: string[] } | { stage: "failed"; message: string };

const GENERIC_ERROR_MESSAGE = `We couldn't calculate your estimate right now. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;

interface QuoteWizardProps {
  /** Server-rendered instant, seeds the first-cleaning offer badge so hydration never mismatches (same pattern as Hero.tsx). */
  nowIso: string;
  initialReferralCode?: string;
}

export default function QuoteWizard({ nowIso, initialReferralCode = "" }: QuoteWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>("step1");
  const [formState, setFormState] = useState<WizardFormState>({
    ...DEFAULT_WIZARD_FORM_STATE,
    referralCode: initialReferralCode,
  });
  const [step1Attempted, setStep1Attempted] = useState(false);
  const [step2Attempted, setStep2Attempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [result, setResult] = useState<
    InstantQuoteRequestAutomaticEstimate | InstantQuoteRequestManualReview | null
  >(null);
  const [selection, setSelection] = useState<AddOnSelection>(EMPTY_ADD_ON_SELECTION);
  const [referralFeedback, setReferralFeedback] = useState<ReferralCodeCheckResult | null>(null);
  const [referralChecking, setReferralChecking] = useState(false);
  const [showContinueWithoutReferral, setShowContinueWithoutReferral] = useState(false);

  const trackerRef = useRef(createReferralCodeCheckTracker());

  async function runReferralCheck(
    rawCode: string,
    options: { force?: boolean } = {}
  ): Promise<ReferralCodeCheckResult | null> {
    const tracker = trackerRef.current;
    const began = tracker.begin(rawCode, options);
    if (began.skip) {
      if (began.reason === "empty") {
        setReferralFeedback(null);
        setReferralChecking(false);
        setShowContinueWithoutReferral(false);
      }
      return tracker.getSettled()?.result ?? null;
    }

    setReferralChecking(true);
    try {
      const result = await checkReferralCodeAction(rawCode);
      if (tracker.isStale(began.requestId)) return null;
      tracker.accept(began.requestId, began.codeKey, result);
      setReferralFeedback(result);
      return result;
    } catch {
      if (tracker.isStale(began.requestId)) return null;
      const errorResult: ReferralCodeCheckResult = { status: "error" };
      tracker.accept(began.requestId, began.codeKey, errorResult);
      setReferralFeedback(errorResult);
      return errorResult;
    } finally {
      if (!tracker.isStale(began.requestId)) {
        setReferralChecking(false);
      }
    }
  }

  // Page-load check when ?ref seeded the field. Schedule outside the effect
  // body so the probe's setState is not synchronous within the effect.
  useEffect(() => {
    const seeded = initialReferralCode.trim();
    if (!seeded) return;
    const tracker = trackerRef.current;
    const timer = window.setTimeout(() => {
      void runReferralCheck(initialReferralCode);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      tracker.clearOnFieldChange();
    };
  }, [initialReferralCode]);

  function updateField<K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) {
    if (key === "referralCode") {
      trackerRef.current.clearOnFieldChange();
      setReferralFeedback(null);
      setReferralChecking(false);
      setShowContinueWithoutReferral(false);
    }
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  function handleContinueFromStepOne() {
    setStep1Attempted(true);
    if (!isStepOneValid(formState.zip)) return;
    setPhase("step2");
  }

  function handleBackToStepOne() {
    setPhase("step1");
  }

  function handleReferralBlur() {
    void runReferralCheck(formState.referralCode);
  }

  async function submitQuote(current: WizardFormState) {
    setSubmitting(true);
    setSubmitError(null);

    const rawInput = mapWizardFormToRawInput(current);

    try {
      const response = await submitInstantQuoteRequest(rawInput);
      if (response.success) {
        setResult(response);
        setPhase("result");
      } else if (response.stage === "validation") {
        setSubmitError({ stage: "validation", errors: response.errors });
      } else {
        setSubmitError({ stage: "failed", message: response.message });
      }
    } catch {
      setSubmitError({ stage: "failed", message: GENERIC_ERROR_MESSAGE });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    setStep2Attempted(true);
    if (submitting || referralChecking) return;
    if (!isStepTwoValid(formState)) return;

    const code = formState.referralCode.trim();
    if (code.length > 0) {
      const check = await runReferralCheck(code, { force: true });
      if (check?.status === "inactive") {
        setShowContinueWithoutReferral(true);
        return;
      }
      if (check === null || check.status === "error" || check.status === "rate_limited") {
        setShowContinueWithoutReferral(false);
        if (check === null) {
          setReferralFeedback({ status: "error" });
        }
        return;
      }
      setShowContinueWithoutReferral(false);
    }

    await submitQuote(formState);
  }

  function handleContinueWithoutReferral() {
    trackerRef.current.clearOnFieldChange();
    setReferralFeedback(null);
    setShowContinueWithoutReferral(false);
    const cleared: WizardFormState = { ...formState, referralCode: "" };
    setFormState(cleared);
    void submitQuote(cleared);
  }

  function handleEditDetails() {
    setResult(null);
    setSubmitError(null);
    setSelection(EMPTY_ADD_ON_SELECTION);
    setPhase("step1");
  }

  if (phase === "result" && result) {
    const selectionQuery = encodeCustomizationSelectionParams(selection).toString();
    const bookingHref =
      result.success && result.quoteId
        ? `/quote/${result.quoteId}/booking${selectionQuery ? `?${selectionQuery}` : ""}`
        : undefined;

    return (
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20 lg:px-8">
        <EstimateResult result={result} frequency="one_time" onEditDetails={handleEditDetails} bookingHref={bookingHref}>
          <CustomizeSection formState={formState} onSelectionChange={setSelection} />
        </EstimateResult>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20 lg:px-8">
      {phase === "step1" && (
        <StepOneCleaning
          formState={formState}
          onFieldChange={updateField}
          onContinue={handleContinueFromStepOne}
          showErrors={step1Attempted}
          nowIso={nowIso}
        />
      )}

      {phase === "step2" && (
        <div className="mx-auto max-w-2xl">
          {submitError && (
            <div role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {submitError.stage === "failed" ? (
                <p>{submitError.message}</p>
              ) : (
                <ul className="list-inside list-disc">
                  {submitError.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <StepTwoContact
            formState={formState}
            onFieldChange={updateField}
            onBack={handleBackToStepOne}
            onSubmit={() => {
              void handleSubmit();
            }}
            submitting={submitting}
            showErrors={step2Attempted}
            referralFeedback={referralFeedback}
            referralChecking={referralChecking}
            showContinueWithoutReferral={showContinueWithoutReferral}
            onReferralBlur={handleReferralBlur}
            onContinueWithoutReferral={handleContinueWithoutReferral}
          />
        </div>
      )}
    </div>
  );
}
