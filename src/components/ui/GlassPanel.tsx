import type { ReactNode } from "react";

export default function GlassPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-border bg-white/80 shadow-sm shadow-foreground/5 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}
