import { PROPERTY_TYPES, type PropertyTypeId } from "@/lib/property-types";
import { SERVICES, type ServiceId } from "@/lib/services";

/**
 * Property types recognized by the quote system. Extends the homepage hero's
 * four photographed types with "custom" (Custom/Other) — approved for quote
 * capture, but not yet part of the hero image selector.
 */
export type QuotePropertyTypeId = PropertyTypeId | "custom";

const CUSTOM_PROPERTY_TYPE_LABEL = "Custom/Other";

export function getQuotePropertyTypeLabel(id: string): string {
  const match = PROPERTY_TYPES.find((type) => type.id === id);
  if (match) {
    return match.name;
  }
  return id === "custom" ? CUSTOM_PROPERTY_TYPE_LABEL : id;
}

export function getQuoteServiceLabel(id: string): string {
  const match = SERVICES.find((service) => service.id === id);
  return match ? match.name : id;
}

export type { ServiceId };
