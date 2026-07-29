"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { DEFAULT_PROPERTY_TYPE_ID, type PropertyTypeId } from "@/lib/property-types";
import { DEFAULT_SERVICE_ID, type ServiceId } from "@/lib/services";

interface SelectionContextValue {
  propertyType: PropertyTypeId;
  serviceId: ServiceId;
  hasInteracted: boolean;
  setPropertyType: (id: PropertyTypeId) => void;
  setServiceId: (id: ServiceId) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [propertyType, setPropertyTypeState] = useState<PropertyTypeId>(
    DEFAULT_PROPERTY_TYPE_ID
  );
  const [serviceId, setServiceIdState] = useState<ServiceId>(DEFAULT_SERVICE_ID);
  const [hasInteracted, setHasInteracted] = useState(false);

  function setPropertyType(id: PropertyTypeId) {
    setHasInteracted(true);
    setPropertyTypeState(id);
  }

  function setServiceId(id: ServiceId) {
    setHasInteracted(true);
    setServiceIdState(id);
  }

  return (
    <SelectionContext.Provider
      value={{ propertyType, serviceId, hasInteracted, setPropertyType, setServiceId }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return context;
}
