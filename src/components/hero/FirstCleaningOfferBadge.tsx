"use client";

import { useEffect, useState } from "react";
import {
  formatCountdown,
  getActiveFirstCleaningOffer,
  getCountdownParts,
  type ActiveFirstCleaningOffer,
} from "@/lib/offers/first-cleaning-offer";

const LAUNCH_SUPPORTING_TEXT = "Launch Month Special · Ends August 31";
const STANDARD_SUPPORTING_TEXT = "New customers · All cleaning service types";
const DEADLINE_LABEL = "Offer ends August 31, 2026 at 11:59 PM Central Time";
// The "Up to" qualifier and this note are required together: the $99
// minimum service total can reduce the effective discount on smaller jobs
// below the advertised percentage, so the badge must never imply every job
// gets the full percentage off.
const MINIMUM_SERVICE_TOTAL_NOTE = "*$99 minimum service total applies.";

interface OfferSnapshot {
  asOfMs: number;
  offer: ActiveFirstCleaningOffer;
}

function computeSnapshot(asOfMs: number): OfferSnapshot {
  return { asOfMs, offer: getActiveFirstCleaningOffer(new Date(asOfMs)) };
}

interface FirstCleaningOfferBadgeProps {
  /** Server-rendered instant (ISO string) used to seed the first client render so hydration never mismatches. */
  nowIso: string;
}

/**
 * Seeded from the server-rendered instant so the first client render is a
 * pure function of props and matches SSR exactly. A client-only interval
 * then re-evaluates the active offer every second against the visitor's
 * own clock, which also makes the launch-to-standard transition (and the
 * countdown reaching zero) happen live without a redeploy.
 */
export default function FirstCleaningOfferBadge({ nowIso }: FirstCleaningOfferBadgeProps) {
  const [snapshot, setSnapshot] = useState<OfferSnapshot>(() =>
    computeSnapshot(new Date(nowIso).getTime())
  );

  useEffect(() => {
    const tick = () => setSnapshot(computeSnapshot(Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const { offer, asOfMs } = snapshot;
  const countdownText =
    offer.showCountdown && offer.expiresAt
      ? formatCountdown(getCountdownParts(new Date(asOfMs), offer.expiresAt))
      : null;

  return (
    <div className="inline-flex flex-col gap-1 rounded-2xl border border-primary/40 bg-foreground/50 px-4 py-2.5 backdrop-blur-sm sm:px-5 sm:py-3">
      <div className="flex items-center gap-3 sm:gap-4">
        <span className="text-2xl leading-none font-bold text-primary sm:text-3xl">
          Up to {offer.percent}% OFF
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-white">Your First Cleaning</span>
          <span className="text-xs text-white/70">
            {offer.offerType === "launch" ? LAUNCH_SUPPORTING_TEXT : STANDARD_SUPPORTING_TEXT}
          </span>
        </span>
      </div>

      {countdownText && (
        <p className="text-xs font-medium tabular-nums text-white/85">
          <span aria-hidden="true">{countdownText}</span>
          <span className="sr-only">{DEADLINE_LABEL}</span>
        </p>
      )}

      <p className="text-[11px] text-white/60">{MINIMUM_SERVICE_TOTAL_NOTE}</p>
    </div>
  );
}
