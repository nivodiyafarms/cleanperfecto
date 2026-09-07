import type { Metadata } from "next";
import Link from "next/link";
import { buildAchPackageOptions } from "@/lib/booking/ach-package-options";
import { buildBookingPricingOptions } from "@/lib/booking/build-booking-pricing-options";
import {
  parseCustomizationSelectionParams,
  type CustomizationSelectionSearchParams,
} from "@/lib/booking/customization-selection-params";
import { getQuoteForBooking } from "@/lib/booking/get-quote-for-booking";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { checkFirstCleaningEligibility } from "@/lib/instant-quote/first-cleaning-eligibility";
import { SITE_CONTACT } from "@/lib/site-contact";
import BookingPaymentClient from "@/components/booking/BookingPaymentClient";
import GlassPanel from "@/components/ui/GlassPanel";

export const metadata: Metadata = {
  title: "Booking & Payment — CleanPerfecto",
  description: "Secure your CleanPerfecto booking or purchase a 6+ cleaning prepaid package.",
};

function NotBookableMessage({ reason }: { reason: string }) {
  const message =
    reason === "not_found"
      ? "We couldn't find that quote."
      : reason === "manual_review"
        ? "This quote needs a quick manual review before it can be booked instantly."
        : "We need to confirm a few details before this quote can be booked online.";

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 sm:py-20 lg:px-8">
      <GlassPanel className="p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Booking not available yet</h1>
        <p className="mt-3 text-muted">{message}</p>
        <p className="mt-3 text-muted">
          Please contact CleanPerfecto at{" "}
          <a href={SITE_CONTACT.phoneHref} className="font-medium text-secondary underline underline-offset-2">
            {SITE_CONTACT.phoneDisplay}
          </a>{" "}
          and we&apos;ll take care of it.
        </p>
        <Link
          href="/quote"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Start a new quote
        </Link>
      </GlassPanel>
    </div>
  );
}

interface BookingPageProps {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<CustomizationSelectionSearchParams>;
}

export default async function QuoteBookingPage({ params, searchParams }: BookingPageProps) {
  const { quoteId } = await params;
  const resolvedSearchParams = await searchParams;
  const selection = parseCustomizationSelectionParams(resolvedSearchParams);
  const { addOnIds, specialRooms, movePackageLevel, outdoorSelection, quantifiedAddOns } = selection;

  const repo = createSupabaseBookingRepository();
  const quoteResult = await getQuoteForBooking(quoteId, repo);

  if (!quoteResult.ok) {
    return <NotBookableMessage reason={quoteResult.reason} />;
  }
  const quote = quoteResult.quote;

  const eligibility = await checkFirstCleaningEligibility(
    {
      emailNormalized: quote.emailNormalized,
      phoneNormalized: quote.phoneNormalized,
      serviceAddressIdentity: quote.serviceAddressIdentity,
    },
    repo
  );

  const options = buildBookingPricingOptions({
    baseInput: quote.baseInput,
    firstCleaningEligible: eligibility.eligible,
    addOnIds,
    specialRooms,
    movePackageLevel,
    outdoorSelection,
    quantifiedAddOns,
    asOf: new Date(),
  });
  const achPackageOptions = buildAchPackageOptions(options.packages);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20 lg:px-8">
      <BookingPaymentClient
        quoteId={quoteId}
        defaultFrequency={quote.baseInput.frequency}
        selection={selection}
        normalOptions={options.normal}
        futureRecurringOptions={options.futureRecurring}
        packageOptions={options.packages}
        achPackageOptions={achPackageOptions}
      />
    </div>
  );
}
