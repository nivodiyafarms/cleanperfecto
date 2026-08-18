import { ADD_ON_CATALOG } from "@/lib/pricing/add-ons";
import type { AddOnId, Condition } from "@/lib/pricing/types";
import { getFrequencyLabel } from "@/lib/quote/frequency";
import { PROPERTY_TYPES } from "@/lib/property-types";
import { SERVICES } from "@/lib/services";
import type { InstantQuotePropertyType } from "../types";

// Small, email-only label lookups. Reuses existing catalogs wherever they
// already cover the value (PROPERTY_TYPES, SERVICES, getFrequencyLabel,
// ADD_ON_CATALOG) rather than re-declaring those strings. "apartment" isn't
// in the legacy PROPERTY_TYPES catalog (that catalog predates the approved
// customer/quote data model), so it gets a one-off fallback below instead of
// duplicating the other four entries just to add a fifth.

const APARTMENT_LABEL = "Apartment";

export function getInstantQuotePropertyTypeLabel(propertyType: InstantQuotePropertyType): string {
  const match = PROPERTY_TYPES.find((type) => type.id === propertyType);
  return match ? match.name : APARTMENT_LABEL;
}

/** cleaningType ("standard"/"deep"/"move") is a subset of the legacy ServiceId — reuses SERVICES for its display name. */
export function getInstantQuoteCleaningTypeLabel(cleaningType: "standard" | "deep" | "move"): string {
  const match = SERVICES.find((service) => service.id === cleaningType);
  return match ? match.name : cleaningType;
}

export { getFrequencyLabel as getInstantQuoteFrequencyLabel };

const CONDITION_LABELS: Record<Condition, string> = {
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  extensive: "Extensive",
};

export function getConditionLabel(condition: Condition): string {
  return CONDITION_LABELS[condition];
}

export function getAddOnLabel(id: AddOnId): string {
  return ADD_ON_CATALOG[id].label;
}
