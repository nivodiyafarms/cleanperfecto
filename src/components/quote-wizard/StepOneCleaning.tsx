"use client";

import { useEffect } from "react";
import type { CleaningType, Condition, FrequencyId } from "@/lib/pricing/types";
import FirstCleaningOfferBadge from "@/components/hero/FirstCleaningOfferBadge";
import { validateStepOne } from "./step-validation";
import type { WizardFormState, WizardPropertyType } from "./wizard-types";

const PROPERTY_OPTIONS: { id: WizardPropertyType; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "apartment", label: "Apartment" },
  { id: "airbnb", label: "Airbnb" },
];

const CLEANING_OPTIONS: { id: CleaningType; label: string; blurb: string }[] = [
  { id: "standard", label: "Standard", blurb: "Routine maintenance clean" },
  { id: "deep", label: "Deep", blurb: "Built-up dirt & grime" },
  { id: "move", label: "Move-In/Move-Out", blurb: "Empty-property reset" },
];

const BEDROOM_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Studio" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5+" },
];

const FULL_BATH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4+" },
];

const HALF_BATH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2+" },
];

const CONDITION_OPTIONS: { id: Condition; label: string; helper: string }[] = [
  { id: "light", label: "Light", helper: "Regularly maintained" },
  { id: "moderate", label: "Moderate", helper: "Some buildup" },
  { id: "heavy", label: "Heavy", helper: "Needs extra attention" },
  { id: "extensive", label: "Extensive", helper: "Significant buildup" },
];

const FREQUENCY_OPTIONS: { id: FrequencyId; label: string }[] = [
  { id: "one_time", label: "One-Time" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every 2 Weeks" },
  { id: "every_4_weeks", label: "Every 4 Weeks" },
];

function OptionPills<T extends string | number>({
  options,
  selected,
  onSelect,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(option.value)}
            className={`min-h-11 min-w-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              isSelected
                ? "border-secondary bg-secondary text-foreground"
                : "border-border bg-white text-muted hover:border-secondary/50 hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface StepOneCleaningProps {
  formState: WizardFormState;
  onFieldChange: <K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) => void;
  onContinue: () => void;
  showErrors: boolean;
  nowIso: string;
}

export default function StepOneCleaning({
  formState,
  onFieldChange,
  onContinue,
  showErrors,
  nowIso,
}: StepOneCleaningProps) {
  const errors = validateStepOne(formState.zip);

  useEffect(() => {
    if (showErrors && errors.zip) {
      document.getElementById("wizard-zip")?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrors]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm font-medium text-muted">Step 1 of 2</p>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-border">
          <div className="h-full w-1/2 rounded-full bg-primary" />
        </div>
      </div>

      <div className="mb-6">
        <FirstCleaningOfferBadge nowIso={nowIso} />
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Tell us about your cleaning
      </h1>

      <div className="mt-8 flex flex-col gap-7">
        <div>
          <p className="mb-2.5 text-sm font-medium text-foreground">Property</p>
          <OptionPills
            options={PROPERTY_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            selected={formState.propertyType}
            onSelect={(value) => onFieldChange("propertyType", value)}
            ariaLabel="Property type"
          />
        </div>

        <div>
          <p className="mb-2.5 text-sm font-medium text-foreground">Cleaning type</p>
          <div role="group" aria-label="Cleaning type" className="grid gap-2.5 sm:grid-cols-3">
            {CLEANING_OPTIONS.map((option) => {
              const isSelected = option.id === formState.cleaningType;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onFieldChange("cleaningType", option.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? "border-secondary bg-secondary/10"
                      : "border-border bg-white hover:border-secondary/50"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{option.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2.5 text-sm font-medium text-foreground">Bedrooms</p>
            <OptionPills
              options={BEDROOM_OPTIONS}
              selected={formState.bedrooms}
              onSelect={(value) => onFieldChange("bedrooms", value)}
              ariaLabel="Bedrooms"
            />
          </div>
          <div>
            <p className="mb-2.5 text-sm font-medium text-foreground">Full bathrooms</p>
            <OptionPills
              options={FULL_BATH_OPTIONS}
              selected={formState.fullBathrooms}
              onSelect={(value) => onFieldChange("fullBathrooms", value)}
              ariaLabel="Full bathrooms"
            />
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2.5 text-sm font-medium text-muted">Half bathrooms</p>
            <OptionPills
              options={HALF_BATH_OPTIONS}
              selected={formState.halfBathrooms}
              onSelect={(value) => onFieldChange("halfBathrooms", value)}
              ariaLabel="Half bathrooms"
            />
          </div>
          <div>
            <label htmlFor="wizard-sqft" className="mb-2.5 block text-sm font-medium text-foreground">
              Approx. home size
            </label>
            <input
              id="wizard-sqft"
              name="square-footage"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 1,200 sq. ft. (optional)"
              value={formState.squareFeet}
              onChange={(event) => onFieldChange("squareFeet", event.target.value.replace(/[^\d]/g, ""))}
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div>
          <p className="mb-2.5 text-sm font-medium text-foreground">Condition</p>
          <div role="group" aria-label="Condition" className="grid gap-2.5 sm:grid-cols-2">
            {CONDITION_OPTIONS.map((option) => {
              const isSelected = option.id === formState.condition;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onFieldChange("condition", option.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? "border-secondary bg-secondary/10"
                      : "border-border bg-white hover:border-secondary/50"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{option.helper}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="wizard-zip" className="mb-2.5 block text-sm font-medium text-foreground">
              ZIP code
            </label>
            <input
              id="wizard-zip"
              name="zip"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              value={formState.zip}
              onChange={(event) => onFieldChange("zip", event.target.value.replace(/[^\d]/g, ""))}
              aria-invalid={showErrors && Boolean(errors.zip) ? true : undefined}
              aria-describedby={showErrors && errors.zip ? "wizard-zip-error" : undefined}
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {showErrors && errors.zip && (
              <p id="wizard-zip-error" role="alert" className="mt-1.5 text-sm text-red-600">
                {errors.zip}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2.5 text-sm font-medium text-foreground">Frequency</p>
            <OptionPills
              options={FREQUENCY_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
              selected={formState.frequency}
              onSelect={(value) => onFieldChange("frequency", value)}
              ariaLabel="Frequency"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary sm:w-auto"
      >
        Continue
      </button>
    </div>
  );
}
