import type { ServiceId } from "@/lib/services";

const LAYER_TRANSITION = "transition-opacity duration-700 ease-out";

function opacity(active: boolean) {
  return active ? "opacity-100" : "opacity-0";
}

export default function PropertyFallback({
  serviceId,
}: {
  serviceId: ServiceId;
}) {
  const furnitureVisible =
    serviceId === "standard" || serviceId === "deep" || serviceId === "recurring";

  return (
    <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-background-alt to-white p-6 sm:p-10">
      <svg viewBox="0 0 480 420" role="img" aria-hidden="true" className="h-full w-full">
        <defs>
          <clipPath id="cpf-interior-clip">
            <rect x="150" y="200" width="180" height="82" rx="8" />
          </clipPath>
        </defs>

        {/* Recurring cycle ring */}
        <circle
          cx="240"
          cy="250"
          r="188"
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeDasharray="4 12"
          strokeLinecap="round"
          className={`${LAYER_TRANSITION} ${opacity(serviceId === "recurring")}`}
        />

        <line x1="70" y1="350" x2="410" y2="350" stroke="var(--color-border)" strokeWidth="1.5" />

        <polygon
          points="90,180 240,70 390,180"
          fill="var(--color-background-alt)"
          stroke="var(--color-border)"
          strokeWidth="1.5"
        />

        <rect
          x="110"
          y="180"
          width="260"
          height="170"
          rx="6"
          fill="var(--color-surface)"
          stroke="var(--color-border)"
          strokeWidth="1.5"
        />

        <rect x="140" y="300" width="30" height="30" rx="4" fill="var(--color-background-alt)" />
        <rect x="310" y="300" width="30" height="30" rx="4" fill="var(--color-background-alt)" />
        <rect x="222" y="280" width="36" height="70" rx="3" fill="var(--color-background-alt)" />

        <rect
          x="150"
          y="200"
          width="180"
          height="82"
          rx="8"
          fill="var(--color-background-alt)"
          stroke="var(--color-border)"
          strokeWidth="1.5"
        />

        <g clipPath="url(#cpf-interior-clip)">
          <g className={`${LAYER_TRANSITION} ${opacity(furnitureVisible)}`}>
            <rect x="165" y="245" width="60" height="22" rx="6" fill="var(--color-secondary)" fillOpacity="0.5" />
            <rect x="252" y="250" width="30" height="15" rx="3" fill="var(--color-secondary)" fillOpacity="0.35" />
            <line x1="300" y1="270" x2="300" y2="248" stroke="var(--color-secondary)" strokeOpacity="0.5" strokeWidth="2" />
            <circle cx="300" cy="244" r="6" fill="var(--color-primary)" fillOpacity="0.6" />
          </g>

          <g className={`${LAYER_TRANSITION} ${opacity(serviceId === "deep")}`}>
            {[
              [185, 225],
              [220, 262],
              [258, 225],
              [292, 258],
            ].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6" fill="var(--color-primary)" />
            ))}
          </g>

          <rect
            x="162"
            y="212"
            width="156"
            height="58"
            rx="6"
            fill="none"
            stroke="var(--color-primary)"
            strokeOpacity="0.6"
            strokeWidth="1.5"
            strokeDasharray="5 7"
            className={`${LAYER_TRANSITION} ${opacity(serviceId === "move")}`}
          />
        </g>
      </svg>
    </div>
  );
}
