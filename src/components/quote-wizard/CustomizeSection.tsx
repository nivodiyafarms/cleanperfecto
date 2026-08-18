"use client";

import { useState } from "react";
import { ADD_ON_CATALOG } from "@/lib/pricing/add-ons";
import type { AddOnId } from "@/lib/pricing/types";
import { previewInstantQuoteCustomization } from "@/lib/instant-quote/preview-instant-quote-customization";
import type { InstantQuoteCustomizationPreviewResult } from "@/lib/instant-quote/preview-instant-quote-customization-result";
import type { LeadSource } from "@/lib/instant-quote/types";
import { mapWizardFormToRawInput } from "./map-form-to-raw-input";
import { DEFAULT_POST_ESTIMATE_DETAILS, type PostEstimateDetails, type WizardFormState } from "./wizard-types";

const ALL_ADD_ON_IDS = Object.keys(ADD_ON_CATALOG) as AddOnId[];

const LEAD_SOURCE_OPTIONS: { id: LeadSource; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "facebook_instagram", label: "Facebook / Instagram" },
  { id: "referral", label: "Friend / Referral" },
  { id: "apartment_flyer_business_card", label: "Apartment / Flyer / Business Card" },
  { id: "returning_customer", label: "Returning Customer" },
  { id: "other", label: "Other" },
];

function addOnPriceLabel(id: AddOnId): string {
  const definition = ADD_ON_CATALOG[id];
  if (definition.kind === "fixed") return `+$${definition.amount}`;
  if (definition.kind === "starting_at") return `Starting at $${definition.amount}`;
  return "Price to be confirmed";
}

function AddOnChip({
  id,
  selected,
  onToggle,
}: {
  id: AddOnId;
  selected: boolean;
  onToggle: () => void;
}) {
  const definition = ADD_ON_CATALOG[id];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
        selected ? "border-secondary bg-secondary/10" : "border-border bg-white hover:border-secondary/50"
      }`}
    >
      <span className="text-sm font-medium text-foreground">{definition.label}</span>
      <span className="text-xs font-medium text-muted">{addOnPriceLabel(id)}</span>
    </button>
  );
}

interface CustomizeSectionProps {
  formState: WizardFormState;
}

/**
 * Phase 1 post-estimate customization: add-ons only. No prepaid-package /
 * per-visit UI exists here (that belongs to the future Booking + Payment
 * milestone's 6+ prepaid package flow) and no preferred-date field (real
 * scheduling is part of that same future milestone) — see wizard-types.ts.
 */
export default function CustomizeSection({ formState }: CustomizeSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [addOnIds, setAddOnIds] = useState<AddOnId[]>([]);
  const [preview, setPreview] = useState<InstantQuoteCustomizationPreviewResult | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [postEstimate, setPostEstimate] = useState<PostEstimateDetails>(DEFAULT_POST_ESTIMATE_DETAILS);

  async function requestPreview(nextAddOnIds: AddOnId[]) {
    setPreviewPending(true);
    const rawInput = mapWizardFormToRawInput(formState, { addOnIds: nextAddOnIds });
    try {
      const result = await previewInstantQuoteCustomization(rawInput);
      setPreview(result);
    } catch {
      setPreview({
        success: false,
        stage: "failed",
        message: "We couldn't update your estimate right now. Please try again.",
      });
    } finally {
      setPreviewPending(false);
    }
  }

  function toggleAddOn(id: AddOnId) {
    const next = addOnIds.includes(id) ? addOnIds.filter((existing) => existing !== id) : [...addOnIds, id];
    setAddOnIds(next);
    void requestPreview(next);
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="text-sm font-semibold text-secondary underline decoration-secondary/40 underline-offset-2"
      >
        {expanded ? "Hide extras" : "Customize your cleaning"}
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-6 rounded-3xl border border-border bg-white p-5 sm:p-6">
          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Add extras</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {ALL_ADD_ON_IDS.map((id) => (
                <AddOnChip key={id} id={id} selected={addOnIds.includes(id)} onToggle={() => toggleAddOn(id)} />
              ))}
            </div>
          </div>

          <PreviewSummary preview={preview} pending={previewPending} />

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="wizard-lead-source" className="mb-2 block text-sm font-medium text-foreground">
                How did you hear about us?
              </label>
              <select
                id="wizard-lead-source"
                value={postEstimate.leadSource}
                onChange={(event) =>
                  setPostEstimate((prev) => ({ ...prev, leadSource: event.target.value as LeadSource | "" }))
                }
                className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
              >
                <option value="">Select one (optional)</option>
                {LEAD_SOURCE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="wizard-notes" className="mb-2 block text-sm font-medium text-foreground">
                Anything else we should know? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="wizard-notes"
                rows={3}
                value={postEstimate.leadSourceDetail}
                onChange={(event) =>
                  setPostEstimate((prev) => ({ ...prev, leadSourceDetail: event.target.value }))
                }
                className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
              />
            </div>
          </div>

          <p className="text-sm text-muted">
            Our team will follow up to confirm your final scope and booking details.
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewSummary({
  preview,
  pending,
}: {
  preview: InstantQuoteCustomizationPreviewResult | null;
  pending: boolean;
}) {
  if (pending) {
    return <p className="text-sm text-muted">Updating your estimate…</p>;
  }

  if (!preview) {
    return null;
  }

  if (!preview.success) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {preview.stage === "failed" ? preview.message : "Please review your extras and try again."}
      </p>
    );
  }

  if (preview.estimateType === "manual_review") {
    return <p className="text-sm text-muted">{preview.customerMessage}</p>;
  }

  return (
    <div className="rounded-2xl bg-background-alt p-4">
      <p className="text-sm font-medium text-foreground">Updated estimate</p>
      <p className="mt-1 text-2xl font-bold text-foreground">
        {preview.hasStartingAtPricing ? "Starting at " : ""}${preview.displayRangeLower}–$
        {preview.displayRangeUpper}
      </p>
      {preview.manualReviewRequired && (
        <p className="mt-2 text-sm text-muted">
          We&apos;ll confirm pricing for this extra before your cleaning.
        </p>
      )}
    </div>
  );
}
