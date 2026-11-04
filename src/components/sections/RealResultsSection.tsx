"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FACEBOOK_URL,
  REAL_RESULTS,
  REAL_RESULTS_HEADING,
  TIKTOK_URL,
  pickActiveIndex,
} from "@/lib/landing/real-results";

/**
 * "Real homes. Real results." — short, silent before/after clips of real jobs.
 * - Video src is attached only once a card is near the viewport.
 * - Only the single most-visible card plays; others pause. Pauses when the tab is hidden.
 * - A manual pause is respected until the user presses play again.
 * - prefers-reduced-motion: poster only, tap to play. Autoplay failure falls back to tap-to-play.
 */
export default function RealResultsSection() {
  const count = REAL_RESULTS.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const ratiosRef = useRef<number[]>(Array(count).fill(0));
  const userPausedRef = useRef<boolean[]>(Array(count).fill(false));

  const [loaded, setLoaded] = useState<boolean[]>(() => Array(count).fill(false));
  const [playing, setPlaying] = useState<boolean[]>(() => Array(count).fill(false));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    const onVis = () => setTabHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mq.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Lazy-attach sources when a card gets near the viewport.
  useEffect(() => {
    const near = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          setLoaded((prev) => (prev[i] ? prev : prev.map((v, k) => (k === i ? true : v))));
        }
      },
      { rootMargin: "300px" },
    );
    const visible = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index);
          ratiosRef.current[i] = e.isIntersecting ? e.intersectionRatio : 0;
        }
        setActiveIndex(pickActiveIndex(ratiosRef.current));
      },
      { threshold: [0, 0.25, 0.6, 0.8, 1] },
    );
    for (const el of cardRefs.current) {
      if (el) {
        near.observe(el);
        visible.observe(el);
      }
    }
    return () => {
      near.disconnect();
      visible.disconnect();
    };
  }, []);

  // Track which card is centered in the mobile scroller for "1 of 3".
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const first = cardRefs.current[0];
      if (!first) return;
      const step = first.offsetWidth + 16;
      setCurrent(Math.max(0, Math.min(count - 1, Math.round(scroller.scrollLeft / step))));
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [count]);

  // Play the active card only; pause all others.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      const shouldAutoplay =
        i === activeIndex && !tabHidden && !reducedMotion && !autoplayBlocked && !userPausedRef.current[i] && loaded[i];
      if (shouldAutoplay) {
        v.play().catch(() => setAutoplayBlocked(true));
      } else if (!v.paused && (i !== activeIndex || tabHidden)) {
        v.pause();
      } else if (!v.paused && (reducedMotion || autoplayBlocked) && i !== activeIndex) {
        v.pause();
      }
    });
  }, [activeIndex, tabHidden, reducedMotion, autoplayBlocked, loaded]);

  const togglePlay = useCallback((i: number) => {
    setLoaded((prev) => (prev[i] ? prev : prev.map((v, k) => (k === i ? true : v))));
    const v = videoRefs.current[i];
    if (!v) return;
    if (v.paused) {
      userPausedRef.current[i] = false;
      videoRefs.current.forEach((o, k) => {
        if (o && k !== i && !o.paused) o.pause();
      });
      // Source may have just been attached; wait a frame.
      requestAnimationFrame(() => {
        videoRefs.current[i]?.play().catch(() => undefined);
      });
    } else {
      userPausedRef.current[i] = true;
      v.pause();
    }
  }, []);

  const goTo = (i: number) => {
    const target = Math.max(0, Math.min(count - 1, i));
    const card = cardRefs.current[target];
    const scroller = scrollerRef.current;
    if (card && scroller) {
      scroller.scrollTo({ left: card.offsetLeft - scroller.offsetLeft, behavior: reducedMotion ? "auto" : "smooth" });
    }
  };

  const setPlayingAt = (i: number, value: boolean) =>
    setPlaying((prev) => (prev[i] === value ? prev : prev.map((p, k) => (k === i ? value : p))));

  return (
    <section id="real-results" aria-labelledby="real-results-heading" className="bg-background px-6 py-10 sm:py-12 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="real-results-heading" className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {REAL_RESULTS_HEADING}
          </h2>
          <p className="mt-4 text-lg text-muted">Before and after clips from real jobs by our team.</p>
        </div>

        <div
          ref={scrollerRef}
          className="-mx-6 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-6 px-6 pb-2 [scrollbar-width:none] md:mx-auto md:grid md:max-w-5xl md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 lg:mt-10"
          aria-roledescription="carousel"
          aria-label="Before and after videos"
        >
          {REAL_RESULTS.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              data-index={i}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${item.caption}`}
              className="w-[min(72vw,calc(60svh*9/16))] shrink-0 snap-start md:w-auto"
            >
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-foreground/10 shadow-sm">
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  className="absolute inset-0 h-full w-full object-cover"
                  src={loaded[i] ? item.src : undefined}
                  poster={item.poster}
                  width={720}
                  height={1280}
                  muted
                  playsInline
                  loop
                  preload="none"
                  aria-label={`${item.caption} before and after video`}
                  onPlay={() => setPlayingAt(i, true)}
                  onPause={() => setPlayingAt(i, false)}
                  onClick={() => togglePlay(i)}
                />
                {!playing[i] && (
                  <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                    Watch before &amp; after
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => togglePlay(i)}
                  aria-label={`${playing[i] ? "Pause" : "Play"} video: ${item.caption}`}
                  className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {playing[i] ? (
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
              <p className="mt-3 text-center text-sm font-medium text-foreground">{item.caption}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-center gap-4 md:hidden">
          <button
            type="button"
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
            aria-label="Previous video"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-foreground/20 text-foreground disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span className="text-sm text-muted" aria-live="polite">
            {current + 1} of {count}
          </span>
          <button
            type="button"
            onClick={() => goTo(current + 1)}
            disabled={current === count - 1}
            aria-label="Next video"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-foreground/20 text-foreground disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="mt-8 flex flex-col items-center gap-4">
          <Link
            href="/quote"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Get my quote
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4 hover:text-muted">
              See more on TikTok
            </a>
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4 hover:text-muted">
              See more on Facebook
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
