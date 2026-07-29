"use client";

import { useState } from "react";
import {
  COMMERCIAL_PROPERTY_TYPE_IDS,
  DEFAULT_PROPERTY_TYPE_ID,
  PROPERTY_TYPES,
  type PropertyTypeId,
} from "@/lib/property-types";
import { DEFAULT_SERVICE_ID, SERVICES, type ServiceId } from "@/lib/services";
import PropertyCanvasLoader from "./PropertyCanvasLoader";
import PropertyTypeSelector from "./PropertyTypeSelector";
import ServiceSelector from "./ServiceSelector";
import StaticPropertyIllustration from "./StaticPropertyIllustration";

export default function HeroInteractive() {
  const [propertyType, setPropertyType] = useState<PropertyTypeId>(
    DEFAULT_PROPERTY_TYPE_ID
  );
  const [serviceId, setServiceId] = useState<ServiceId>(DEFAULT_SERVICE_ID);

  const activeProperty =
    PROPERTY_TYPES.find((type) => type.id === propertyType) ?? PROPERTY_TYPES[0];
  const activeService =
    SERVICES.find((service) => service.id === serviceId) ?? SERVICES[0];
  const isCommercial = COMMERCIAL_PROPERTY_TYPE_IDS.includes(propertyType);

  return (
    <div className="flex flex-col items-center gap-6 sm:items-start">
      <PropertyTypeSelector
        propertyTypes={PROPERTY_TYPES}
        selectedId={propertyType}
        onSelect={setPropertyType}
      />

      {activeProperty.visual === "scene" ? (
        <PropertyCanvasLoader serviceId={serviceId} />
      ) : (
        <StaticPropertyIllustration propertyType={propertyType} />
      )}

      <ServiceSelector
        services={SERVICES}
        selectedId={serviceId}
        onSelect={setServiceId}
      />

      <div className="flex flex-col items-center gap-2 sm:items-start">
        <a
          href="#quote"
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          {isCommercial ? "Request a Commercial Quote" : "Get Instant Quote"}
        </a>
        <p className="max-w-xs text-center text-xs text-muted sm:text-left">
          Pricing depends on property size, condition, service type, and
          frequency.
        </p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {activeProperty.name} — {activeService.name}
        {activeProperty.visual === "scene" ? `: ${activeService.visualState}` : "."}
      </p>
    </div>
  );
}
