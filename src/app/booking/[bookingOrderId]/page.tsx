import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { NORMAL_FREQUENCY_LABELS, PREPAID_FREQUENCY_LABELS } from "@/lib/booking/labels";
import type { PrepaidFrequency } from "@/lib/booking/types";
import { SITE_CONTACT } from "@/lib/site-contact";
import GlassPanel from "@/components/ui/GlassPanel";

export const metadata: Metadata = {
  title: "Booking Status — CleanPerfecto",
};

interface BookingStatusPageProps {
  params: Promise<{ bookingOrderId: string }>;
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export default async function BookingStatusPage({ params }: BookingStatusPageProps) {
  const { bookingOrderId } = await params;
  const repo = createSupabaseBookingRepository();
  const bookingOrder = await repo.findBookingOrderById(bookingOrderId);

  if (!bookingOrder) {
    notFound();
  }

  // This page never trusts a Stripe session_id query param as proof of
  // anything — it only ever reflects the current, webhook-verified
  // booking_orders.status read fresh from the database. See
  // src/lib/booking/webhook/process-stripe-webhook-event.ts for the only
  // place that status actually changes.
  const isNormal = bookingOrder.bookingType === "normal";

  let heading: string;
  let body: string;

  if (isNormal) {
    if (bookingOrder.status === "pending_confirmation") {
      heading = "Booking request received";
      body = `Your payment method has been securely saved. Your card has not been charged. CleanPerfecto will confirm availability for your requested ${NORMAL_FREQUENCY_LABELS[bookingOrder.frequency]} cleaning.`;
    } else {
      heading = "Finalizing your booking…";
      body = "Please wait about 10 seconds while we finalize your booking. If this page does not update automatically, refresh it once.";
    }
  } else {
    if (bookingOrder.status === "payment_completed") {
      const total = bookingOrder.prepaidPackageTotal !== null ? formatMoney(bookingOrder.prepaidPackageTotal) : null;
      const perCleaning = bookingOrder.effectivePricePerVisit !== null ? formatMoney(bookingOrder.effectivePricePerVisit) : null;
      heading = "Package purchased";
      body = `Thank you! Your ${PREPAID_FREQUENCY_LABELS[bookingOrder.frequency as PrepaidFrequency]} 6-cleaning package (6 visits)${
        total ? `, ${total} total, ${perCleaning} per cleaning,` : ""
      } has been purchased. Your cleaning dates have not been scheduled yet — our team will follow up to arrange them.`;
    } else {
      // Not yet activated — distinguish a card payment's brief in-flight
      // moment from an ACH payment, which is a Stripe "delayed
      // notification" method that can take multiple business days to
      // settle (see process-stripe-webhook-event.ts). The package only
      // becomes active once the webhook verifies a successful payment —
      // an unconfirmed ACH submission is never called "purchased".
      const activeAttempt = await repo.findActivePaymentAttempt(bookingOrder.id);
      if (activeAttempt?.paymentMethodType === "us_bank_account") {
        const total = bookingOrder.prepaidPackageTotal !== null ? formatMoney(bookingOrder.prepaidPackageTotal) : null;
        const perCleaning = bookingOrder.effectivePricePerVisit !== null ? formatMoney(bookingOrder.effectivePricePerVisit) : null;
        heading = "Payment processing";
        body = `Your ${PREPAID_FREQUENCY_LABELS[bookingOrder.frequency as PrepaidFrequency]} 6-cleaning package${
          total ? ` (${total} total, ${perCleaning} per cleaning)` : ""
        } — your bank payment has been submitted. Your package will activate once the payment is confirmed, which can take a few business days. Cleaning dates can be arranged after activation.`;
      } else {
        heading = "Finalizing your payment…";
        body = "Please wait about 10 seconds while we finalize your booking. If this page does not update automatically, refresh it once.";
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 sm:py-20 lg:px-8">
      <GlassPanel className="p-8 text-center">
        <p className="text-sm font-medium text-muted">CleanPerfecto</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{heading}</h1>
        <p className="mt-4 text-muted">{body}</p>
        <p className="mt-6 text-sm text-muted">
          Questions? Contact CleanPerfecto at{" "}
          <a href={SITE_CONTACT.phoneHref} className="font-medium text-secondary underline underline-offset-2">
            {SITE_CONTACT.phoneDisplay}
          </a>
          .
        </p>
      </GlassPanel>
    </div>
  );
}
