"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";

const POSTER_SRC = "/images/cleanperfecto-hero-poster.webp";
const VIDEO_SRC = "/videos/cleanperfecto-hero.mp4";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// Server/first-paint default: assume reduced motion so SSR and the initial
// client render both show the poster only, with no hydration mismatch.
function getServerSnapshot() {
  return true;
}

/**
 * The poster is the only thing rendered on first paint. The video is only
 * mounted once the client confirms prefers-reduced-motion is not set.
 */
export default function HeroVideoBackground() {
  const prefersReducedMotion = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const showVideo = !prefersReducedMotion;

  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden bg-foreground">
      <Image
        src={POSTER_SRC}
        alt=""
        fill
        priority
        sizes="100vw"
        className={`object-cover ${showVideo ? "invisible" : "visible"}`}
      />

      {showVideo && (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={POSTER_SRC}
          tabIndex={-1}
        >
          <source src={VIDEO_SRC} type="video/mp4" />
          A bright, freshly cleaned home interior.
        </video>
      )}

      <div className="absolute inset-0 bg-foreground/35 lg:bg-foreground/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-foreground/95 via-foreground/65 to-transparent lg:from-foreground/85 lg:via-foreground/50" />
    </div>
  );
}
