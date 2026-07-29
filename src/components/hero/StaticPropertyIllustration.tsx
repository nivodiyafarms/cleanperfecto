import type { PropertyTypeId } from "@/lib/property-types";

function OfficeIllustration() {
  return (
    <svg viewBox="0 0 480 420" role="img" aria-hidden="true" className="h-full w-full">
      <line x1="70" y1="350" x2="410" y2="350" stroke="var(--color-border)" strokeWidth="1.5" />

      <rect x="90" y="70" width="300" height="280" rx="10" fill="var(--color-background-alt)" stroke="var(--color-border)" strokeWidth="1.5" />

      {/* Ceiling light */}
      <rect x="200" y="90" width="80" height="10" rx="5" fill="var(--color-primary)" fillOpacity="0.5" />

      {/* Window */}
      <rect x="300" y="110" width="60" height="80" rx="6" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.5" />

      {/* Desk */}
      <rect x="140" y="250" width="160" height="14" rx="4" fill="var(--color-secondary)" fillOpacity="0.5" />
      <rect x="150" y="264" width="10" height="70" fill="var(--color-foreground)" fillOpacity="0.25" />
      <rect x="280" y="264" width="10" height="70" fill="var(--color-foreground)" fillOpacity="0.25" />

      {/* Monitor */}
      <rect x="190" y="205" width="60" height="42" rx="4" fill="var(--color-foreground)" fillOpacity="0.55" />
      <rect x="212" y="247" width="16" height="10" fill="var(--color-foreground)" fillOpacity="0.35" />

      {/* Chair */}
      <rect x="150" y="300" width="34" height="8" rx="4" fill="var(--color-foreground)" fillOpacity="0.3" />
      <rect x="158" y="270" width="18" height="34" rx="6" fill="var(--color-primary)" fillOpacity="0.4" />

      {/* Plant accent */}
      <circle cx="330" cy="310" r="12" fill="var(--color-primary)" fillOpacity="0.35" />
      <rect x="322" y="310" width="16" height="20" rx="3" fill="var(--color-foreground)" fillOpacity="0.2" />
    </svg>
  );
}

function RestaurantIllustration() {
  return (
    <svg viewBox="0 0 480 420" role="img" aria-hidden="true" className="h-full w-full">
      <line x1="70" y1="350" x2="410" y2="350" stroke="var(--color-border)" strokeWidth="1.5" />

      <rect x="90" y="70" width="300" height="280" rx="10" fill="var(--color-background-alt)" stroke="var(--color-border)" strokeWidth="1.5" />

      {/* Service counter */}
      <rect x="110" y="110" width="120" height="60" rx="6" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.5" />
      <rect x="110" y="104" width="120" height="8" rx="3" fill="var(--color-primary)" fillOpacity="0.55" />

      {/* Pendant light */}
      <line x1="290" y1="90" x2="290" y2="130" stroke="var(--color-foreground)" strokeOpacity="0.3" strokeWidth="2" />
      <circle cx="290" cy="138" r="12" fill="var(--color-primary)" fillOpacity="0.45" />

      {/* Dining table */}
      <ellipse cx="290" cy="255" rx="60" ry="20" fill="var(--color-secondary)" fillOpacity="0.4" />
      <rect x="284" y="255" width="12" height="55" fill="var(--color-foreground)" fillOpacity="0.2" />

      {/* Chairs */}
      <rect x="215" y="260" width="16" height="34" rx="6" fill="var(--color-foreground)" fillOpacity="0.25" />
      <rect x="349" y="260" width="16" height="34" rx="6" fill="var(--color-foreground)" fillOpacity="0.25" />
    </svg>
  );
}

export default function StaticPropertyIllustration({
  propertyType,
}: {
  propertyType: PropertyTypeId;
}) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-background-alt to-white p-6 sm:p-10">
      {propertyType === "office" ? <OfficeIllustration /> : <RestaurantIllustration />}
    </div>
  );
}
