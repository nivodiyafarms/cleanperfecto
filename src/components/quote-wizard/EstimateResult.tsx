import Link from "next/link";
import GlassPanel from "@/components/ui/GlassPanel";
import { getInstantQuoteFrequencyLabel } from "@/lib/instant-quote/email/labels";
import type { FrequencyId } from "@/lib/pricing/types";
import type {
  InstantQuoteRequestAutomaticEstimate,
  InstantQuoteRequestManualReview,
} from "@/lib/instant-quote/instant-quote-request-result";
import type { ReactNode } from "react";

function formatRange(lower: number, upper: number): string {
  return `$${lower}–$${upper}`;
}

/**
 * Owner-approved 2026-09-27: the customer-facing residential booking price
 * is a single number — the upper bound of the same post-discount range
 * already computed server-side (displayRangeUpper, sourced from
 * calculateEstimate()'s own range.upper — see resolveCustomerBookingPrice
 * in src/lib/pricing/customer-booking-price.ts, the same value the booking
 * flow later persists as the original booking amount). Never recalculated
 * here — this only chooses which already-authoritative field to render.
 */
function formatCustomerPrice(upper: number): string {
  return `$${upper}`;
}

/** "Your One-Time/Weekly/Every 2 Weeks/Every 4 Weeks Cleaning Estimate" — represents the frequency the customer selected, never an internal percentage. */
function frequencyEstimateLabel(frequency: FrequencyId): string {
  return `Your ${getInstantQuoteFrequencyLabel(frequency)} Cleaning Estimate`;
}

function AutomaticEstimatePanel({
  result,
  frequency,
}: {
  result: InstantQuoteRequestAutomaticEstimate;
  frequency: FrequencyId;
}) {
  const showComparison =
    result.firstCleaningOfferApplied &&
    result.regularDisplayRangeLower !== null &&
    result.regularDisplayRangeUpper !== null;

  return (
    <GlassPanel className="p-6 sm:p-8">
      <p className="text-sm font-medium text-muted">{frequencyEstimateLabel(frequency)}</p>

      {showComparison ? (
        <div className="mt-1">
          <p className="text-xs font-medium text-muted">Regular estimate (before your discount)</p>
          <p className="relative mt-1 inline-block text-2xl font-semibold text-muted">
            <span>{formatRange(result.regularDisplayRangeLower as number, result.regularDisplayRangeUpper as number)}</span>
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-0 h-[2px] w-0 -translate-y-1/2 animate-[quote-strike-grow_500ms_ease-out_forwards] bg-foreground/60"
            />
          </p>

          <div className="mt-4 origin-left translate-y-2 animate-[quote-fade-slide-in_400ms_ease-out_450ms_forwards] opacity-0">
            <p className="text-sm font-semibold text-primary">🎉 First Cleaning Special Applied</p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {formatCustomerPrice(result.displayRangeUpper)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {formatCustomerPrice(result.displayRangeUpper)}
        </p>
      )}

      {result.minimumServiceFloorApplied && (
        <p className="mt-4 text-xs text-muted">*$99 minimum service total applies.</p>
      )}

      {result.hasStartingAtPricing && (
        <p className="mt-3 text-sm text-muted">
          This is a starting-at estimate. Final pricing may be confirmed if the condition or selected
          starting-at services require additional review.
        </p>
      )}

      {result.manualReviewRequired && (
        <p className="mt-3 text-sm text-muted">
          One of your selected extras needs a quick confirmation — we&apos;ll follow up with final pricing
          for that item.
        </p>
      )}
    </GlassPanel>
  );
}

function ManualReviewPanel({ result }: { result: InstantQuoteRequestManualReview }) {
  return (
    <GlassPanel className="p-6 text-center sm:p-8">
      <h2 className="text-xl font-semibold text-foreground">Your request is received</h2>
      <p className="mt-2 text-muted">{result.customerMessage}</p>
    </GlassPanel>
  );
}

interface EstimateResultProps {
  result: InstantQuoteRequestAutomaticEstimate | InstantQuoteRequestManualReview;
  /** The frequency the customer selected in Step 1 — drives the estimate heading, e.g. "Your Weekly Cleaning Estimate". */
  frequency: FrequencyId;
  onEditDetails: () => void;
  /** Link to /quote/[quoteId]/booking (with the currently selected add-ons carried along) — only rendered for an automatic estimate, never for manual review (no bookable instant range exists yet). */
  bookingHref?: string;
  /** Rendered below the estimate panel — the "Customize your cleaning" section, only meaningful for an automatic estimate. */
  children?: ReactNode;
}

export default function EstimateResult({ result, frequency, onEditDetails, bookingHref, children }: EstimateResultProps) {
  return (
    <div className="mx-auto max-w-2xl">
      {result.estimateType === "instant_range" ? (
        <AutomaticEstimatePanel result={result} frequency={frequency} />
      ) : (
        <ManualReviewPanel result={result} />
      )}

      <button
        type="button"
        onClick={onEditDetails}
        className="mt-4 text-sm font-medium text-muted underline decoration-border underline-offset-2 hover:text-foreground"
      >
        Edit details
      </button>

      {result.estimateType === "instant_range" && children}

      {result.estimateType === "instant_range" && bookingHref && (
        <Link
          href={bookingHref}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary sm:w-auto"
        >
          Continue to Booking
        </Link>
      )}
    </div>
  );
}
