"use client";

import Link from "next/link";
import { useSelection } from "@/components/SelectionProvider";
import { COMMERCIAL_PROPERTY_TYPE_IDS, PROPERTY_TYPES } from "@/lib/property-types";
import { SERVICES } from "@/lib/services";
import PropertyImage from "./PropertyImage";
import PropertyTypeSelector from "./PropertyTypeSelector";
import ServiceSelector from "./ServiceSelector";

export default function HeroInteractive() {
  const { propertyType, serviceId, setPropertyType, setServiceId } = useSelection();

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

      <PropertyImage property={activeProperty} />

      <ServiceSelector
        services={SERVICES}
        selectedId={serviceId}
        onSelect={setServiceId}
      />

      <div className="w-full max-w-md rounded-2xl border border-border bg-background-alt/60 p-5 text-left">
        <p className="text-sm font-medium text-foreground">{activeService.name}</p>
        <p className="mt-1 text-sm text-muted">{activeService.description}</p>
        <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-2">
          {activeService.included.map((item) => (
            <li key={item} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="mt-0.5 text-secondary">
                &bull;
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col items-center gap-2 sm:items-start">
        <Link
          href={isCommercial ? "#quote" : "/quote"}
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          {isCommercial ? "Request a Commercial Quote" : "Get My Cleaning Quote"}
        </Link>
        <p className="max-w-xs text-center text-xs text-muted sm:text-left">
          Pricing depends on property size, condition, service type, and
          frequency.
        </p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Showing {activeProperty.name}: {activeProperty.image.alt}
      </p>
    </div>
  );
}
