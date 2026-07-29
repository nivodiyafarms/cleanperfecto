import type { PropertyType, PropertyTypeId } from "@/lib/property-types";

export default function PropertyTypeSelector({
  propertyTypes,
  selectedId,
  onSelect,
}: {
  propertyTypes: PropertyType[];
  selectedId: PropertyTypeId;
  onSelect: (id: PropertyTypeId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Property type"
      className="flex flex-wrap justify-center gap-2.5 sm:justify-start"
    >
      {propertyTypes.map((type) => {
        const isSelected = type.id === selectedId;
        return (
          <button
            key={type.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(type.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              isSelected
                ? "border-secondary bg-secondary text-foreground"
                : "border-border bg-white text-muted hover:border-secondary/50 hover:text-foreground"
            }`}
          >
            {type.name}
          </button>
        );
      })}
    </div>
  );
}
