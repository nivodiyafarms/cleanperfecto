"use client";

import { useEffect, useRef, useState } from "react";

export default function StickyMobileCTA() {
  const [hidden, setHidden] = useState(false);
  const intersectingTargets = useRef(new Set<Element>());

  useEffect(() => {
    const targets = [document.getElementById("quote"), document.querySelector("footer")].filter(
      (el): el is HTMLElement => el !== null
    );
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            intersectingTargets.current.add(entry.target);
          } else {
            intersectingTargets.current.delete(entry.target);
          }
        }
        setHidden(intersectingTargets.current.size > 0);
      },
      { rootMargin: "0px 0px -10% 0px" }
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={hidden}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 p-4 backdrop-blur-sm transition-transform duration-300 md:hidden ${
        hidden ? "pointer-events-none translate-y-full" : "translate-y-0"
      }`}
    >
      <a
        href="#quote"
        tabIndex={hidden ? -1 : undefined}
        className="flex w-full items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
      >
        Get Instant Quote
      </a>
    </div>
  );
}
