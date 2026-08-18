"use client";

import { useState } from "react";
import { SITE_CONTACT } from "@/lib/site-contact";
import { submitInstantQuoteRequest } from "@/lib/instant-quote/submit-instant-quote-request";
import type {
  InstantQuoteRequestAutomaticEstimate,
  InstantQuoteRequestManualReview,
} from "@/lib/instant-quote/instant-quote-request-result";
import CustomizeSection from "./CustomizeSection";
import EstimateResult from "./EstimateResult";
import { mapWizardFormToRawInput } from "./map-form-to-raw-input";
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
}

export default function QuoteWizard({ nowIso }: QuoteWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>("step1");
  const [formState, setFormState] = useState<WizardFormState>(DEFAULT_WIZARD_FORM_STATE);
  const [step1Attempted, setStep1Attempted] = useState(false);
  const [step2Attempted, setStep2Attempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [result, setResult] = useState<
    InstantQuoteRequestAutomaticEstimate | InstantQuoteRequestManualReview | null
  >(null);

  function updateField<K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) {
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

  async function handleSubmit() {
    setStep2Attempted(true);
    if (submitting) return;
    if (!isStepTwoValid(formState)) return;

    setSubmitting(true);
    setSubmitError(null);

    const rawInput = mapWizardFormToRawInput(formState);

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

  function handleEditDetails() {
    setResult(null);
    setSubmitError(null);
    setPhase("step1");
  }

  if (phase === "result" && result) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20 lg:px-8">
        <EstimateResult result={result} frequency={formState.frequency} onEditDetails={handleEditDetails}>
          <CustomizeSection formState={formState} />
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
            onSubmit={handleSubmit}
            submitting={submitting}
            showErrors={step2Attempted}
          />
        </div>
      )}
    </div>
  );
}
