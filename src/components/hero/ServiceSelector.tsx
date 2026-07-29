import type { Service, ServiceId } from "@/lib/services";

export default function ServiceSelector({
  services,
  selectedId,
  onSelect,
}: {
  services: Service[];
  selectedId: ServiceId;
  onSelect: (id: ServiceId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Cleaning service"
      className="flex flex-wrap justify-center gap-2.5 sm:justify-start"
    >
      {services.map((service) => {
        const isSelected = service.id === selectedId;
        return (
          <button
            key={service.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(service.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              isSelected
                ? "border-primary bg-primary text-foreground"
                : "border-border bg-white text-muted hover:border-secondary/50 hover:text-foreground"
            }`}
          >
            {service.name}
          </button>
        );
      })}
    </div>
  );
}
