"use client";

import { useEffect, useState } from "react";
import {
  ADD_ON_CATALOG,
  COMPLETE_MOVE_PACKAGE_ADD_ONS,
  EXTERIOR_WINDOW_CUSTOMER_NOTE,
  QUANTIFIED_ADD_ON_CATALOG,
} from "@/lib/pricing/add-ons";
import {
  ALGAE_MILDEW_CONFIG,
  ALGAE_MILDEW_CUSTOMER_NOTE,
  GARAGE_CONFIG,
  OIL_DEGREASE_PER_BAY,
  OUTDOOR_STANDARD_SCOPE_NOTE,
  PATIO_CONFIG,
  PORCH_CONFIG,
  TRIO_CONFIG,
} from "@/lib/pricing/outdoor-add-ons";
import type {
  AddOnId,
  AlgaeMildewTreatmentSize,
  MovePackageLevel,
  OutdoorSelection,
  PatioSize,
  PorchSize,
  QuantifiedAddOnId,
  QuantifiedAddOnSelection,
  SpecialRoomId,
  TrioSize,
} from "@/lib/pricing/types";
import { previewInstantQuoteCustomization } from "@/lib/instant-quote/preview-instant-quote-customization";
import type { InstantQuoteCustomizationPreviewResult } from "@/lib/instant-quote/preview-instant-quote-customization-result";
import type { LeadSource } from "@/lib/instant-quote/types";
import { mapWizardFormToRawInput, type AddOnSelection } from "./map-form-to-raw-input";
import { DEFAULT_POST_ESTIMATE_DETAILS, type PostEstimateDetails, type WizardFormState } from "./wizard-types";

/** Indoor add-ons shown as simple presence/absence toggles (not folded into Complete, not quantity-based, not manual-quote). */
const STANDALONE_INDOOR_ADD_ON_IDS: AddOnId[] = [
  "inside_refrigerator",
  "inside_oven",
  "refrigerator_oven_bundle",
  "inside_cabinets_drawers",
  "extra_pet_hair_removal",
];

const LEAD_SOURCE_OPTIONS: { id: LeadSource; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "facebook_instagram", label: "Facebook / Instagram" },
  { id: "referral", label: "Friend / Referral" },
  { id: "apartment_flyer_business_card", label: "Apartment / Flyer / Business Card" },
  { id: "returning_customer", label: "Returning Customer" },
  { id: "other", label: "Other" },
];

const SPECIAL_ROOM_OPTIONS: { id: SpecialRoomId; label: string }[] = [
  { id: "game_room", label: "Game Room" },
  { id: "media_room", label: "Media / Theater Room" },
];

function addOnPriceLabel(id: AddOnId): string {
  const definition = ADD_ON_CATALOG[id];
  if (definition.kind === "fixed") return `+$${definition.amount}`;
  if (definition.kind === "starting_at") return `Starting at $${definition.amount}`;
  return "Price to be confirmed";
}

interface ToggleChipProps {
  label: string;
  priceLabel: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledNote?: string;
  helperText?: string;
}

function ToggleChip({ label, priceLabel, selected, onToggle, disabled, disabledNote, helperText }: ToggleChipProps) {
  return (
    <div>
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onToggle}
        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
          disabled
            ? "cursor-not-allowed border-border bg-background-alt"
            : selected
              ? "border-secondary bg-secondary/10"
              : "border-border bg-white hover:border-secondary/50"
        }`}
      >
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs font-medium text-muted">
          {disabled ? "✓ Included" : priceLabel}
        </span>
      </button>
      {disabled && disabledNote && <p className="mt-1 text-xs text-muted">{disabledNote}</p>}
      {!disabled && helperText && <p className="mt-1 text-xs text-muted">{helperText}</p>}
    </div>
  );
}

interface SizePickerOption<T extends string> {
  id: T;
  label: string;
  priceLabel: string;
}

function SizePicker<T extends string>({
  ariaLabel,
  options,
  selected,
  onSelect,
}: {
  ariaLabel: string;
  options: SizePickerOption<T>[];
  selected: T | null;
  onSelect: (id: T | null) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = option.id === selected;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? null : option.id)}
            className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
              isSelected ? "border-secondary bg-secondary/10" : "border-border bg-white hover:border-secondary/50"
            }`}
          >
            <span className="block font-medium text-foreground">{option.label}</span>
            <span className="block text-muted">{option.priceLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

const PORCH_OPTIONS: SizePickerOption<PorchSize | "custom">[] = [
  ...PORCH_CONFIG.map((band) => ({
    id: band.size,
    label: `${band.size[0].toUpperCase()}${band.size.slice(1)} (up to ${band.maxSqFt} sq ft)`,
    priceLabel: `+$${band.amount}`,
  })),
  { id: "custom", label: "Larger than 250 sq ft", priceLabel: "Custom Quote" },
];
const PORCH_SIZE_TO_SQFT: Record<PorchSize | "custom", number> = {
  small: 80,
  medium: 150,
  large: 250,
  custom: 251,
};

const PATIO_OPTIONS: SizePickerOption<PatioSize | "custom">[] = [
  ...PATIO_CONFIG.map((band) => ({
    id: band.size,
    label: `${band.size[0].toUpperCase()}${band.size.slice(1)} (up to ${band.maxSqFt} sq ft)`,
    priceLabel: `+$${band.amount}`,
  })),
  { id: "custom", label: "Larger than 500 sq ft", priceLabel: "Custom Quote" },
];
const PATIO_SIZE_TO_SQFT: Record<PatioSize | "custom", number> = {
  small: 150,
  medium: 300,
  large: 500,
  custom: 501,
};

const GARAGE_OPTIONS: SizePickerOption<"1" | "2" | "3" | "custom">[] = [
  ...GARAGE_CONFIG.map((entry) => ({
    id: String(entry.cars) as "1" | "2" | "3",
    label: `${entry.cars}-Car Garage`,
    priceLabel: `+$${entry.amount}`,
  })),
  { id: "custom", label: "More than 3 cars", priceLabel: "Custom Quote" },
];
const GARAGE_ID_TO_CARS: Record<"1" | "2" | "3" | "custom", number> = { "1": 1, "2": 2, "3": 3, custom: 4 };

const TRIO_OPTIONS: SizePickerOption<TrioSize>[] = (Object.keys(TRIO_CONFIG) as TrioSize[]).map((size) => ({
  id: size,
  label: `${size[0].toUpperCase()}${size.slice(1)} Trio`,
  priceLabel: `$${TRIO_CONFIG[size].amount}`,
}));

const ALGAE_MILDEW_OPTIONS: SizePickerOption<AlgaeMildewTreatmentSize>[] = (
  Object.keys(ALGAE_MILDEW_CONFIG) as AlgaeMildewTreatmentSize[]
).map((size) => ({
  id: size,
  label: `${size[0].toUpperCase()}${size.slice(1)}`,
  priceLabel: `+$${ALGAE_MILDEW_CONFIG[size]}`,
}));

interface CustomizationSelection {
  addOnIds: AddOnId[];
  specialRooms: SpecialRoomId[];
  movePackageLevel: MovePackageLevel;
  outdoorSelection: OutdoorSelection;
  quantifiedAddOns: QuantifiedAddOnSelection[];
}

const EMPTY_SELECTION: CustomizationSelection = {
  addOnIds: [],
  specialRooms: [],
  movePackageLevel: "basic",
  outdoorSelection: {},
  quantifiedAddOns: [],
};

function toAddOnSelection(selection: CustomizationSelection): AddOnSelection {
  return {
    addOnIds: selection.addOnIds,
    specialRooms: selection.specialRooms,
    movePackageLevel: selection.movePackageLevel,
    outdoorSelection: selection.outdoorSelection,
    quantifiedAddOns: selection.quantifiedAddOns,
  };
}

function quantifiedQuantity(selection: CustomizationSelection, id: QuantifiedAddOnId): number {
  return selection.quantifiedAddOns.find((entry) => entry.id === id)?.quantity ?? 0;
}

function setQuantifiedQuantity(
  selection: CustomizationSelection,
  id: QuantifiedAddOnId,
  quantity: number
): CustomizationSelection {
  const withoutId = selection.quantifiedAddOns.filter((entry) => entry.id !== id);
  return {
    ...selection,
    quantifiedAddOns: quantity > 0 ? [...withoutId, { id, quantity }] : withoutId,
  };
}

interface CustomizeSectionProps {
  formState: WizardFormState;
  /** Notified with the full customization selection (in the same AddOnSelection shape the pricing engine boundary already uses) on every change, so the parent can carry it into the "Continue to Booking" handoff — see QuoteWizard.tsx. This selection is not persisted to quote_requests; it only exists as this component's local state until the customer proceeds to booking. */
  onSelectionChange?: (selection: AddOnSelection) => void;
}

/**
 * Post-estimate customization: Move Basic/Complete package choice, Game/
 * Media Room, indoor add-ons, and outdoor add-ons. Every number shown here
 * comes from the real production pricing engine via
 * previewInstantQuoteCustomization — nothing is hardcoded or estimated
 * client-side. The "Optional Extras" catalog is always visible (owner
 * feedback, 2026-08-31) — never gated behind a collapsed/accordion toggle,
 * so the customer sees every available extra without an extra click; "How
 * did you hear about us?" and the notes field live in their own separate
 * section below it, visually distinct from pricing controls. No
 * prepaid-package / per-visit UI exists here (that belongs to the future
 * Booking + Payment milestone's 6+ prepaid package flow) and no
 * preferred-date field (real scheduling is part of that same future
 * milestone) — see wizard-types.ts.
 */
export default function CustomizeSection({ formState, onSelectionChange }: CustomizeSectionProps) {
  const [selection, setSelection] = useState<CustomizationSelection>(EMPTY_SELECTION);
  const [preview, setPreview] = useState<InstantQuoteCustomizationPreviewResult | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [basicPreview, setBasicPreview] = useState<InstantQuoteCustomizationPreviewResult | null>(null);
  const [completePreview, setCompletePreview] = useState<InstantQuoteCustomizationPreviewResult | null>(null);
  const [postEstimate, setPostEstimate] = useState<PostEstimateDetails>(DEFAULT_POST_ESTIMATE_DETAILS);

  const isMove = formState.cleaningType === "move";

  async function requestPreview(next: CustomizationSelection) {
    setPreviewPending(true);
    try {
      const result = await previewInstantQuoteCustomization(mapWizardFormToRawInput(formState, toAddOnSelection(next)));
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

    if (isMove) {
      const [basic, complete] = await Promise.all([
        previewInstantQuoteCustomization(
          mapWizardFormToRawInput(formState, toAddOnSelection({ ...next, movePackageLevel: "basic" }))
        ).catch(
          () => ({ success: false, stage: "failed", message: "Unavailable" }) as InstantQuoteCustomizationPreviewResult
        ),
        previewInstantQuoteCustomization(
          mapWizardFormToRawInput(formState, toAddOnSelection({ ...next, movePackageLevel: "complete" }))
        ).catch(
          () => ({ success: false, stage: "failed", message: "Unavailable" }) as InstantQuoteCustomizationPreviewResult
        ),
      ]);
      setBasicPreview(basic);
      setCompletePreview(complete);
    }
  }

  // Show the Move Basic/Complete comparison as soon as this section mounts
  // for a Move-In/Move-Out request, without waiting for the customer to
  // touch an extra first.
  useEffect(() => {
    if (!isMove) return;
    // Deferred to a macrotask so the preview's own setState calls never run
    // synchronously within this effect's execution.
    const timer = setTimeout(() => {
      void requestPreview(selection);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMove]);

  function updateSelection(updater: (prev: CustomizationSelection) => CustomizationSelection) {
    const next = updater(selection);
    setSelection(next);
    onSelectionChange?.(toAddOnSelection(next));
    void requestPreview(next);
  }

  function toggleAddOn(id: AddOnId) {
    updateSelection((prev) => {
      let addOnIds = prev.addOnIds.includes(id)
        ? prev.addOnIds.filter((existing) => existing !== id)
        : [...prev.addOnIds, id];
      // Client-side mirror of the server's bundle-overlap resolution, so the
      // UI never shows a contradictory selection while waiting on the
      // preview round-trip — the server independently enforces this too.
      if (id === "refrigerator_oven_bundle" && addOnIds.includes("refrigerator_oven_bundle")) {
        addOnIds = addOnIds.filter((a) => a !== "inside_refrigerator" && a !== "inside_oven");
      } else if (
        (id === "inside_refrigerator" || id === "inside_oven") &&
        addOnIds.includes("refrigerator_oven_bundle")
      ) {
        addOnIds = addOnIds.filter((a) => a !== "refrigerator_oven_bundle");
      }
      return { ...prev, addOnIds };
    });
  }

  function toggleSpecialRoom(id: SpecialRoomId) {
    updateSelection((prev) => ({
      ...prev,
      specialRooms: prev.specialRooms.includes(id)
        ? prev.specialRooms.filter((existing) => existing !== id)
        : [...prev.specialRooms, id],
    }));
  }

  function selectMovePackageLevel(level: MovePackageLevel) {
    updateSelection((prev) => ({ ...prev, movePackageLevel: level }));
  }

  function selectPorch(id: PorchSize | "custom" | null) {
    updateSelection((prev) => ({
      ...prev,
      outdoorSelection: {
        ...prev.outdoorSelection,
        porchSqFt: id ? PORCH_SIZE_TO_SQFT[id] : undefined,
      },
    }));
  }

  function selectPatio(id: PatioSize | "custom" | null) {
    updateSelection((prev) => ({
      ...prev,
      outdoorSelection: { ...prev.outdoorSelection, patioSqFt: id ? PATIO_SIZE_TO_SQFT[id] : undefined },
    }));
  }

  function selectGarage(id: "1" | "2" | "3" | "custom" | null) {
    updateSelection((prev) => ({
      ...prev,
      outdoorSelection: { ...prev.outdoorSelection, garageCars: id ? GARAGE_ID_TO_CARS[id] : undefined },
    }));
  }

  function selectTrio(id: TrioSize | null) {
    updateSelection((prev) => ({
      ...prev,
      // Trio is deliberate/explicit and replaces individual Porch/Patio/
      // Garage selections in the UI — never auto-bundled, never shown
      // alongside individual selections that would double-charge.
      outdoorSelection: id
        ? { ...prev.outdoorSelection, trio: id }
        : { ...prev.outdoorSelection, trio: undefined },
    }));
  }

  function selectAlgaeMildew(id: AlgaeMildewTreatmentSize | null) {
    updateSelection((prev) => ({
      ...prev,
      outdoorSelection: { ...prev.outdoorSelection, algaeMildewTreatmentSize: id ?? undefined },
    }));
  }

  function setOilDegreaseBays(bays: number) {
    updateSelection((prev) => ({
      ...prev,
      outdoorSelection: {
        ...prev.outdoorSelection,
        oilDegreaseAffectedBays: bays > 0 ? bays : undefined,
      },
    }));
  }

  const isComplete = isMove && selection.movePackageLevel === "complete";
  const outdoor = selection.outdoorSelection;
  const trioSelected = Boolean(outdoor.trio);
  const knownGarageCapacity = trioSelected ? TRIO_CONFIG[outdoor.trio as TrioSize].garageCars : outdoor.garageCars;

  return (
    <div className="mt-8 flex flex-col gap-6">
      {isMove && (
        <MovePackagePicker
          selectedLevel={selection.movePackageLevel}
          onSelect={selectMovePackageLevel}
          basicPreview={basicPreview}
          completePreview={completePreview}
        />
      )}

      <div className="flex flex-col gap-6 rounded-3xl border border-border bg-white p-5 sm:p-6">
        <div>
          <p className="text-base font-semibold text-foreground">Optional Extras</p>
          <p className="mt-1 text-sm text-muted">Add any extra services you need. All selections are optional.</p>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-foreground">Dedicated rooms</p>
          <p className="mb-2 text-xs text-muted">Only counts when it&apos;s a separate, dedicated room.</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {SPECIAL_ROOM_OPTIONS.map((option) => (
              <ToggleChip
                key={option.id}
                label={option.label}
                priceLabel={addOnPriceLabelForSpecialRoom(formState.cleaningType)}
                selected={selection.specialRooms.includes(option.id)}
                onToggle={() => toggleSpecialRoom(option.id)}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-foreground">Indoor add-ons</p>
          {isComplete && (
            <p className="mb-2 text-xs text-muted">
              Complete already includes Refrigerator, Oven, and Cabinet interiors — they can&apos;t be added again
              separately.
            </p>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {STANDALONE_INDOOR_ADD_ON_IDS.map((id) => (
              <ToggleChip
                key={id}
                label={ADD_ON_CATALOG[id].label}
                priceLabel={addOnPriceLabel(id)}
                selected={selection.addOnIds.includes(id)}
                onToggle={() => toggleAddOn(id)}
                disabled={isComplete && COMPLETE_MOVE_PACKAGE_ADD_ONS.includes(id)}
              />
            ))}
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <QuantityStepper
              label={QUANTIFIED_ADD_ON_CATALOG.interior_window_detailing.label}
              priceLabel={`$${QUANTIFIED_ADD_ON_CATALOG.interior_window_detailing.perUnitAmount} each`}
              quantity={quantifiedQuantity(selection, "interior_window_detailing")}
              onChange={(qty) =>
                updateSelection((prev) => setQuantifiedQuantity(prev, "interior_window_detailing", qty))
              }
            />
            <QuantityStepper
              label={QUANTIFIED_ADD_ON_CATALOG.exterior_window_cleaning.label}
              priceLabel={`$${QUANTIFIED_ADD_ON_CATALOG.exterior_window_cleaning.perUnitAmount} each`}
              quantity={quantifiedQuantity(selection, "exterior_window_cleaning")}
              onChange={(qty) =>
                updateSelection((prev) => setQuantifiedQuantity(prev, "exterior_window_cleaning", qty))
              }
              helperText={EXTERIOR_WINDOW_CUSTOMER_NOTE}
            />
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-foreground">Outdoor add-ons</p>

          <p className="mb-2 text-xs font-medium text-foreground">Bundles (Garage + Porch + Patio)</p>
          <div role="group" aria-label="Outdoor Trio bundle" className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={!trioSelected}
              onClick={() => selectTrio(null)}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                !trioSelected ? "border-secondary bg-secondary/10" : "border-border bg-white hover:border-secondary/50"
              }`}
            >
              <span className="block font-medium text-foreground">None</span>
              <span className="block text-muted">Individual pricing</span>
            </button>
            {TRIO_OPTIONS.map((option) => {
              const isSelected = outdoor.trio === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectTrio(isSelected ? null : option.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    isSelected ? "border-secondary bg-secondary/10" : "border-border bg-white hover:border-secondary/50"
                  }`}
                >
                  <span className="block font-medium text-foreground">{option.label}</span>
                  <span className="block text-muted">{option.priceLabel}</span>
                </button>
              );
            })}
          </div>

          {!trioSelected && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Porch</p>
                <SizePicker
                  ariaLabel="Porch size"
                  options={PORCH_OPTIONS}
                  selected={sqFtToSize(outdoor.porchSqFt, PORCH_SIZE_TO_SQFT)}
                  onSelect={selectPorch}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Patio</p>
                <SizePicker
                  ariaLabel="Patio size"
                  options={PATIO_OPTIONS}
                  selected={sqFtToSize(outdoor.patioSqFt, PATIO_SIZE_TO_SQFT)}
                  onSelect={selectPatio}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Garage</p>
                <SizePicker
                  ariaLabel="Garage size"
                  options={GARAGE_OPTIONS}
                  selected={carsToId(outdoor.garageCars)}
                  onSelect={selectGarage}
                />
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Heavy Garage Oil &amp; Degrease</p>
              <QuantityStepper
                label={`Affected bays (+$${OIL_DEGREASE_PER_BAY} each)`}
                priceLabel=""
                quantity={outdoor.oilDegreaseAffectedBays ?? 0}
                max={knownGarageCapacity}
                onChange={setOilDegreaseBays}
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Black Algae &amp; Mildew Deep Treatment</p>
              <SizePicker
                ariaLabel="Algae/mildew treatment size"
                options={ALGAE_MILDEW_OPTIONS}
                selected={outdoor.algaeMildewTreatmentSize ?? null}
                onSelect={selectAlgaeMildew}
              />
              <p className="mt-1 text-xs text-muted">{ALGAE_MILDEW_CUSTOMER_NOTE}</p>
            </div>
          </div>

          <details className="mt-4 rounded-2xl bg-background-alt p-3 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-foreground">What&apos;s included outdoors?</summary>
            <p className="mt-2">{OUTDOOR_STANDARD_SCOPE_NOTE}</p>
          </details>
        </div>

        <PreviewSummary preview={preview} pending={previewPending} selection={selection} isMove={isMove} />
      </div>

      <div className="rounded-3xl border border-border bg-white p-5 sm:p-6">
        <label htmlFor="wizard-lead-source" className="block text-base font-semibold text-foreground">
          How did you hear about us?
        </label>
        <select
          id="wizard-lead-source"
          value={postEstimate.leadSource}
          onChange={(event) =>
            setPostEstimate((prev) => ({ ...prev, leadSource: event.target.value as LeadSource | "" }))
          }
          className="mt-3 w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none sm:max-w-sm"
        >
          <option value="">Select one (optional)</option>
          {LEAD_SOURCE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="mt-5">
          <label htmlFor="wizard-notes" className="mb-2 block text-sm font-medium text-foreground">
            Anything else we should know? <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="wizard-notes"
            rows={3}
            value={postEstimate.leadSourceDetail}
            onChange={(event) => setPostEstimate((prev) => ({ ...prev, leadSourceDetail: event.target.value }))}
            className="w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
          />
        </div>

        <p className="mt-5 text-sm text-muted">
          Our team will follow up to confirm your final scope and booking details.
        </p>
      </div>
    </div>
  );
}

function addOnPriceLabelForSpecialRoom(cleaningType: WizardFormState["cleaningType"]): string {
  if (cleaningType === "standard") return "+$15";
  return "+$20";
}

function sqFtToSize<T extends string>(sqFt: number | undefined, map: Record<T | "custom", number>): T | "custom" | null {
  if (sqFt === undefined) return null;
  const match = (Object.keys(map) as (T | "custom")[]).find((key) => map[key] === sqFt);
  return match ?? null;
}

function carsToId(cars: number | undefined): "1" | "2" | "3" | "custom" | null {
  if (cars === undefined) return null;
  if (cars === 1 || cars === 2 || cars === 3) return String(cars) as "1" | "2" | "3";
  return "custom";
}

function QuantityStepper({
  label,
  priceLabel,
  quantity,
  onChange,
  max,
  helperText,
}: {
  label: string;
  priceLabel: string;
  quantity: number;
  onChange: (quantity: number) => void;
  max?: number;
  helperText?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {label} {priceLabel && <span className="text-xs font-normal text-muted">({priceLabel})</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(Math.max(0, quantity - 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-foreground hover:border-secondary/50"
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-medium text-foreground">{quantity}</span>
          <button
            type="button"
            aria-label={`Increase ${label}`}
            disabled={max !== undefined && quantity >= max}
            onClick={() => onChange(quantity + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-foreground hover:border-secondary/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
      {helperText && <p className="mt-1 text-xs text-muted">{helperText}</p>}
    </div>
  );
}

/**
 * True only when Complete was requested but the property's square footage
 * is beyond the configured Complete-upgrade bands — the number the engine
 * returns in that case is actually Basic's price (see calculate-estimate.ts),
 * so the Complete card must show "Custom Quote" instead of that figure.
 */
function isCompleteUpgradeUnavailable(preview: InstantQuoteCustomizationPreviewResult | null): boolean {
  if (!preview || !preview.success || preview.estimateType !== "instant_range") return false;
  return preview.moveCompleteUpgradeConfigured === false;
}

function MovePackagePicker({
  selectedLevel,
  onSelect,
  basicPreview,
  completePreview,
}: {
  selectedLevel: MovePackageLevel;
  onSelect: (level: MovePackageLevel) => void;
  basicPreview: InstantQuoteCustomizationPreviewResult | null;
  completePreview: InstantQuoteCustomizationPreviewResult | null;
}) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      <MovePackageCard
        title="BASIC"
        selected={selectedLevel === "basic"}
        onSelect={() => onSelect("basic")}
        preview={basicPreview}
        forceCustomQuote={false}
        bullets={[
          "Complete general move turnover cleaning",
          "Cabinet and appliance exteriors included",
        ]}
        exclusions={["Refrigerator Interior", "Oven Interior", "Cabinet Interiors"]}
      />
      <MovePackageCard
        title="COMPLETE"
        badge="RECOMMENDED"
        selected={selectedLevel === "complete"}
        onSelect={() => onSelect("complete")}
        preview={completePreview}
        forceCustomQuote={isCompleteUpgradeUnavailable(completePreview)}
        bullets={["Everything in Basic, plus:"]}
        includes={["Refrigerator Interior", "Oven Interior", "Cabinet Interiors"]}
      />
    </div>
  );
}

function MovePackageCard({
  title,
  badge,
  selected,
  onSelect,
  preview,
  forceCustomQuote,
  bullets,
  exclusions,
  includes,
}: {
  title: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
  preview: InstantQuoteCustomizationPreviewResult | null;
  forceCustomQuote: boolean;
  bullets: string[];
  exclusions?: string[];
  includes?: string[];
}) {
  const priceNode = (() => {
    if (forceCustomQuote) {
      return <span className="text-2xl font-bold text-foreground">Custom Quote</span>;
    }
    if (!preview) {
      return <span className="text-sm text-muted">Calculating…</span>;
    }
    if (!preview.success || preview.estimateType === "manual_review") {
      return <span className="text-sm text-muted">Custom Quote</span>;
    }
    return (
      <span className="text-2xl font-bold text-foreground">
        {preview.hasStartingAtPricing ? "Estimated price " : ""}${preview.displayRangeUpper}
        <span className="ml-1 text-sm font-normal text-muted">+ applicable tax</span>
      </span>
    );
  })();

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex flex-col gap-2 rounded-3xl border-2 p-5 text-left transition-colors ${
        selected ? "border-secondary bg-secondary/10" : "border-border bg-white hover:border-secondary/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold tracking-wide text-foreground">{title}</p>
        {badge && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-foreground">
            {badge}
          </span>
        )}
      </div>
      <div>{priceNode}</div>
      <ul className="mt-1 space-y-1 text-sm text-muted">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
        {includes?.map((item) => (
          <li key={item} className="text-foreground">
            ✓ {item}
          </li>
        ))}
        {exclusions?.map((item) => (
          <li key={item}>Excludes {item}</li>
        ))}
      </ul>
    </button>
  );
}

function PreviewSummary({
  preview,
  pending,
  selection,
  isMove,
}: {
  preview: InstantQuoteCustomizationPreviewResult | null;
  pending: boolean;
  selection: CustomizationSelection;
  isMove: boolean;
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

  const selectedNames: string[] = [
    ...selection.specialRooms.map((id) => SPECIAL_ROOM_OPTIONS.find((o) => o.id === id)?.label ?? id),
    ...selection.addOnIds.map((id) => ADD_ON_CATALOG[id].label),
    ...selection.quantifiedAddOns
      .filter((entry) => entry.quantity > 0)
      .map((entry) => `${QUANTIFIED_ADD_ON_CATALOG[entry.id].label} ×${entry.quantity}`),
    ...(selection.outdoorSelection.trio
      ? [`${selection.outdoorSelection.trio[0].toUpperCase()}${selection.outdoorSelection.trio.slice(1)} Trio Bundle`]
      : [
          ...(selection.outdoorSelection.porchSqFt ? ["Porch Cleaning"] : []),
          ...(selection.outdoorSelection.patioSqFt ? ["Patio Cleaning"] : []),
          ...(selection.outdoorSelection.garageCars ? [`${selection.outdoorSelection.garageCars}-Car Garage Cleaning`] : []),
        ]),
    ...(selection.outdoorSelection.oilDegreaseAffectedBays ? ["Heavy Garage Oil & Degrease"] : []),
    ...(selection.outdoorSelection.algaeMildewTreatmentSize ? ["Black Algae & Mildew Deep Treatment"] : []),
  ];

  if (preview.estimateType === "manual_review") {
    return <p className="text-sm text-muted">{preview.customerMessage}</p>;
  }

  return (
    <div className="rounded-2xl bg-background-alt p-4">
      <p className="text-sm font-medium text-foreground">
        {isMove ? "Updated estimate for the selected package" : "Updated estimate"}
      </p>
      <p className="mt-1 text-2xl font-bold text-foreground">
        {preview.hasStartingAtPricing ? "Estimated price " : ""}${preview.displayRangeUpper}
        <span className="ml-1 text-sm font-normal text-muted">+ applicable tax</span>
      </p>
      {selectedNames.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground">Your selections</p>
          <ul className="mt-1 list-inside list-disc text-xs text-muted">
            {selectedNames.map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.manualReviewRequired && (
        <p className="mt-2 text-sm text-muted">
          We&apos;ll confirm pricing for this extra before your cleaning.
        </p>
      )}
    </div>
  );
}
