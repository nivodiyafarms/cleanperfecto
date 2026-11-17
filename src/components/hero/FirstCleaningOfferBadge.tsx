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
const DEEP_ONLY_SUPPORTING_TEXT = "New customers · Deep Cleaning only";
const DEADLINE_LABEL_LAUNCH = "Offer ends August 31, 2026 at 11:59 PM Central Time";
const DEADLINE_LABEL_STANDARD = "Offer ends November 30, 2026 at 11:59 PM Central Time";
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

  const supportingText =
    offer.offerType === "launch"
      ? LAUNCH_SUPPORTING_TEXT
      : offer.offerType === "standard"
        ? STANDARD_SUPPORTING_TEXT
        : DEEP_ONLY_SUPPORTING_TEXT;

  const deadlineLabel = offer.offerType === "launch" ? DEADLINE_LABEL_LAUNCH : DEADLINE_LABEL_STANDARD;

  // For deep_only offer, we show the specific message about Deep Cleaning
  const headlineText =
    offer.offerType === "deep_only"
      ? "Your First Deep Cleaning"
      : "Your First Cleaning";

  // Build the offer end date label for visible display
  const offerEndsLabel =
    offer.offerType === "launch"
      ? "Offer ends August 31"
      : offer.offerType === "standard"
        ? "Offer ends November 30"
        : null;

  return (
    <div className="inline-flex flex-col gap-1.5 rounded-2xl border border-primary/40 bg-foreground/50 px-5 py-3 backdrop-blur-sm sm:py-3.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        <span className="text-2xl leading-none font-bold whitespace-nowrap text-primary sm:text-3xl">
          {offer.offerType === "deep_only" ? `${offer.percent}% OFF` : `Up to ${offer.percent}% OFF`}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-white">{headlineText}</span>
          <span className="text-xs text-white/70">
            {supportingText}
          </span>
        </span>
      </div>

      {countdownText && offerEndsLabel && (
        <p className="text-xs font-medium tabular-nums text-white/85">
          <span aria-hidden="true">{offerEndsLabel} · {countdownText}</span>
          <span className="sr-only">{deadlineLabel}</span>
        </p>
      )}

      {offer.showCountdown && (
        <p className="text-[10px] text-white/60">Times shown in Central Time (CT)</p>
      )}

      <p className="text-[11px] text-white/60">{MINIMUM_SERVICE_TOTAL_NOTE}</p>
    </div>
  );
}
