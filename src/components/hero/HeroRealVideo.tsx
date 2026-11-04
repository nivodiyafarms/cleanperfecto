"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";

export const HERO_REAL_VIDEO_SRC = "/videos/hero-real.mp4";
export const HERO_REAL_POSTER_SRC = "/images/hero-real-poster.jpg";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function getSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
// SSR/first paint: assume reduced motion so only the poster renders (no hydration mismatch).
function getServerSnapshot() {
  return true;
}

/**
 * Real after-cleaning footage shown as a restrained 9:16 card beside the hero copy.
 * - autoplay=true (desktop): muted looping autoplay unless reduced motion; pause control.
 * - autoplay=false (mobile): poster with tap-to-play.
 * Poster is priority-loaded; the card reserves its 9:16 box so there is no layout shift.
 */
export default function HeroRealVideo({ autoplay, className = "" }: { autoplay: boolean; className?: string }) {
  const reducedMotion = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [userStarted, setUserStarted] = useState(false);
  const [playing, setPlaying] = useState(false);

  const mountVideo = userStarted || (autoplay && !reducedMotion);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mountVideo) return;
    v.play().catch(() => setPlaying(false));
  }, [mountVideo]);

  const toggle = () => {
    if (!mountVideo) {
      setUserStarted(true);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  };

  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-3xl bg-white/10 shadow-2xl ring-1 ring-white/15 ${className}`}>
      <Image
        src={HERO_REAL_POSTER_SRC}
        alt="A glass stovetop after a CleanPerfecto deep clean"
        fill
        priority
        sizes="(min-width: 1024px) 360px, 60vw"
        className="object-cover"
      />
      {mountVideo && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={HERO_REAL_VIDEO_SRC}
          poster={HERO_REAL_POSTER_SRC}
          width={720}
          height={1280}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          aria-label="Real CleanPerfecto results: stovetop, shower glass and bathtub after cleaning"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause video of our real results" : "Play video of our real results"}
        className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {playing ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
        )}
      </button>
    </div>
  );
}
