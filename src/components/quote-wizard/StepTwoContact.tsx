"use client";

import { useEffect } from "react";
import { validateStepTwo } from "./step-validation";
import type { WizardFormState } from "./wizard-types";

const fieldClass =
  "w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50";
const labelClass = "mb-2 block text-sm font-medium text-foreground";
const errorClass = "mt-1.5 text-sm text-red-600";

interface StepTwoContactProps {
  formState: WizardFormState;
  onFieldChange: <K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  showErrors: boolean;
}

const FIELD_FOCUS_ORDER = ["firstName", "phone", "email", "addressLine1", "city"] as const;
const FIELD_ID: Record<(typeof FIELD_FOCUS_ORDER)[number], string> = {
  firstName: "wizard-first-name",
  phone: "wizard-phone",
  email: "wizard-email",
  addressLine1: "wizard-address-line1",
  city: "wizard-city",
};

export default function StepTwoContact({
  formState,
  onFieldChange,
  onBack,
  onSubmit,
  submitting,
  showErrors,
}: StepTwoContactProps) {
  const errors = validateStepTwo(formState);

  useEffect(() => {
    if (!showErrors) return;
    const firstInvalid = FIELD_FOCUS_ORDER.find((field) => errors[field]);
    if (firstInvalid) {
      document.getElementById(FIELD_ID[firstInvalid])?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrors]);

  const showUnit = formState.propertyType === "apartment" || formState.propertyType === "airbnb";
  const unitRequired = formState.propertyType === "apartment";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm font-medium text-muted">Step 2 of 2</p>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-border">
          <div className="h-full w-full rounded-full bg-primary" />
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Where should we send your estimate?
      </h1>
      <p className="mt-2 text-sm text-muted">
        Your first-cleaning special will be checked and automatically applied when eligible.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={FIELD_ID.firstName} className={labelClass}>
            First name
          </label>
          <input
            id={FIELD_ID.firstName}
            name="firstName"
            type="text"
            autoComplete="given-name"
            value={formState.firstName}
            onChange={(event) => onFieldChange("firstName", event.target.value)}
            aria-invalid={showErrors && Boolean(errors.firstName) ? true : undefined}
            className={fieldClass}
          />
          {showErrors && errors.firstName && <p className={errorClass}>{errors.firstName}</p>}
        </div>

        <div>
          <label htmlFor={FIELD_ID.phone} className={labelClass}>
            Phone
          </label>
          <input
            id={FIELD_ID.phone}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={formState.phone}
            onChange={(event) => onFieldChange("phone", event.target.value)}
            aria-invalid={showErrors && Boolean(errors.phone) ? true : undefined}
            className={fieldClass}
          />
          {showErrors && errors.phone && <p className={errorClass}>{errors.phone}</p>}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={FIELD_ID.email} className={labelClass}>
            Email <span className="font-normal text-muted">(optional — get a copy of your estimate)</span>
          </label>
          <input
            id={FIELD_ID.email}
            name="email"
            type="email"
            autoComplete="email"
            value={formState.email}
            onChange={(event) => onFieldChange("email", event.target.value)}
            aria-invalid={showErrors && Boolean(errors.email) ? true : undefined}
            className={fieldClass}
          />
          {showErrors && errors.email && <p className={errorClass}>{errors.email}</p>}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={FIELD_ID.addressLine1} className={labelClass}>
            Service address
          </label>
          <input
            id={FIELD_ID.addressLine1}
            name="address-line1"
            type="text"
            autoComplete="street-address"
            value={formState.addressLine1}
            onChange={(event) => onFieldChange("addressLine1", event.target.value)}
            aria-invalid={showErrors && Boolean(errors.addressLine1) ? true : undefined}
            className={fieldClass}
          />
          {showErrors && errors.addressLine1 && <p className={errorClass}>{errors.addressLine1}</p>}
        </div>

        {showUnit && (
          <div className="sm:col-span-2">
            <label htmlFor="wizard-address-line2" className={labelClass}>
              Unit / Apt {!unitRequired && <span className="font-normal text-muted">(optional)</span>}
            </label>
            <input
              id="wizard-address-line2"
              name="address-line2"
              type="text"
              autoComplete="address-line2"
              value={formState.addressLine2}
              onChange={(event) => onFieldChange("addressLine2", event.target.value)}
              className={fieldClass}
            />
          </div>
        )}

        <div>
          <label htmlFor={FIELD_ID.city} className={labelClass}>
            City
          </label>
          <input
            id={FIELD_ID.city}
            name="city"
            type="text"
            autoComplete="address-level2"
            value={formState.city}
            onChange={(event) => onFieldChange("city", event.target.value)}
            aria-invalid={showErrors && Boolean(errors.city) ? true : undefined}
            className={fieldClass}
          />
          {showErrors && errors.city && <p className={errorClass}>{errors.city}</p>}
        </div>

        <div>
          <p className={labelClass}>State</p>
          <div className={`${fieldClass} flex items-center text-muted`}>Texas (TX)</div>
        </div>
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-secondary disabled:opacity-60"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
        >
          {submitting ? "Calculating your estimate…" : "Get My Personalized Estimate"}
        </button>
      </div>
    </div>
  );
}
