import { LOGO_ARC_PATH, LOGO_SPARKLE_PATH, LOGO_VIEW_BOX } from "./logo-paths";

function LogoMark({
  className,
  gradientId,
}: {
  className?: string;
  gradientId: string;
}) {
  return (
    <svg
      viewBox={LOGO_VIEW_BOX}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="10"
          y1="10"
          x2="54"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--color-secondary)" />
          <stop offset="100%" stopColor="var(--color-primary)" />
        </linearGradient>
      </defs>
      <path
        d={LOGO_ARC_PATH}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path d={LOGO_SPARKLE_PATH} fill="var(--color-primary)" />
    </svg>
  );
}

export default function BrandLogo({
  variant = "horizontal",
  id = "cp-logo",
  className = "",
}: {
  variant?: "horizontal" | "icon";
  id?: string;
  className?: string;
}) {
  const gradientId = `${id}-gradient`;

  if (variant === "icon") {
    return (
      <LogoMark gradientId={gradientId} className={`h-8 w-8 ${className}`} />
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark gradientId={gradientId} className="h-8 w-8 shrink-0" />
      <span className="text-lg font-semibold tracking-tight text-foreground">
        CleanPerfecto
      </span>
    </span>
  );
}
