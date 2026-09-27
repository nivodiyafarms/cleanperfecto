"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createStripeVisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { prepareVisitPaymentReview, type VisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip, type SelectVisitTipResult } from "@/lib/payments/select-visit-tip";
import { createVisitPaymentIntent, type CreateVisitPaymentIntentOutcome } from "@/lib/payments/create-visit-payment-intent";
import { confirmFinalTotalAndPay, type ConfirmFinalTotalAndPayOutcome } from "@/lib/payments/confirm-final-total-and-pay";
import { createPaymentMethodSetupCheckoutSession } from "@/lib/payments/create-payment-method-setup";
import { resolveTipBasisAmount } from "@/lib/payments/resolve-tip-basis";
import { resolveTaxLocationAddress } from "@/lib/payments/resolve-tax-location";
import { resolveTipAmount } from "@/lib/payments/tip-rules";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { getStripeClient } from "@/lib/booking/stripe/client";
import { RuntimeConfigurationError } from "@/lib/config/runtime-env";
import type { TipSelectionType } from "@/lib/scheduling/types";
import { assertVisitBelongsToCustomer } from "@/lib/customer-portal/ownership";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

export type PaymentActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Customer-safe message — never repeats internal configuration jargon (PAYMENT_MODE/TAX_MODE) to the customer; the detailed reason is still on the underlying RuntimeConfigurationError for server-side logs. */
const PAYMENT_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Online payment is temporarily unavailable. Please contact CleanPerfecto for help completing this payment.";

function toErrorResult(error: unknown): { ok: false; error: string } {
  if (error instanceof InvalidVisitStateError) return { ok: false, error: error.message };
  if (error instanceof RuntimeConfigurationError) return { ok: false, error: PAYMENT_TEMPORARILY_UNAVAILABLE_MESSAGE };
  throw error;
}

/** Step 1 — Review Charges. Ownership-checked; creates the payment row if needed and returns a display-only Stripe Tax preview. */
export async function getVisitPaymentReviewAction(serviceVisitId: string): Promise<PaymentActionResult<VisitPaymentReview>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  try {
    const review = await prepareVisitPaymentReview(repo, createStripeVisitPaymentGateway(), serviceVisitId);
    return { ok: true, data: review };
  } catch (error) {
    return toErrorResult(error);
  }
}

/** Step 2 — Tip selection. Freely re-callable pre-freeze. */
export async function selectVisitTipAction(serviceVisitId: string, tipSelectionType: TipSelectionType, customAmount?: number): Promise<PaymentActionResult<SelectVisitTipResult>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  try {
    const result = await selectVisitTip(repo, createStripeVisitPaymentGateway(), { serviceVisitId, tipSelectionType, customAmount });
    return { ok: true, data: result };
  } catch (error) {
    return toErrorResult(error);
  }
}

/** Step 3 — Confirm & Pay. Returns a client_secret for Stripe.js to confirm, or a refreshed/no-payment-due/needs-payment-method outcome. */
export async function confirmVisitPaymentAction(serviceVisitId: string): Promise<PaymentActionResult<CreateVisitPaymentIntentOutcome>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  try {
    const outcome = await createVisitPaymentIntent(repo, createSupabaseBookingRepository(), createStripeVisitPaymentGateway(), {
      serviceVisitId,
      customerId: session.customerId,
    });
    revalidatePath("/my/payments");
    return { ok: true, data: outcome };
  } catch (error) {
    return toErrorResult(error);
  }
}

/** "Add / Update Payment Method" — redirects to a Stripe-hosted setup-mode Checkout Session; the pending visit-payment row/tip selection is untouched. */
export async function createPaymentMethodSetupUrlAction(serviceVisitId: string): Promise<PaymentActionResult<{ url: string }>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  const visit = await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  try {
    const stripe = getStripeClient();
    const bookingRepo = createSupabaseBookingRepository();
    const url = await createPaymentMethodSetupCheckoutSession(stripe, bookingRepo, session.customerId, visit, extractZip(visit.serviceAddressIdentity));
    return { ok: true, data: { url } };
  } catch (error) {
    return toErrorResult(error);
  }
}

export interface CustomerVisitPaymentStatus {
  status: string;
  approvedAmount: number;
  tipAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  paidAt: string | null;
  refundedAmount: number;
  /** Present only once frozen (tipConfirmedAt set) and not yet resolved to a terminal outcome — the client needs this to call confirmVisitPaymentAction again (e.g. requires_action recovery). */
  needsClientConfirmation: boolean;
}

/** Customer-safe status read — deliberately excludes payment_method_type, card brand/last4, external_payment_reference, and every Stripe object id, per the approved customer-visibility rule ("customer sees only Paid, Service, Tax, Tip, Total, Paid date"). */
export async function getVisitPaymentStatusAction(serviceVisitId: string): Promise<PaymentActionResult<CustomerVisitPaymentStatus | null>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  const payment = await repo.findServiceVisitPaymentByVisitId(serviceVisitId);
  if (!payment) return { ok: true, data: null };

  return {
    ok: true,
    data: {
      status: payment.status,
      approvedAmount: payment.approvedAmount,
      tipAmount: payment.tipAmount,
      taxAmount: payment.taxAmount,
      totalAmount: payment.totalAmount,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
      refundedAmount: payment.refundedAmount,
      needsClientConfirmation: payment.tipConfirmedAt !== null && (payment.status === "processing" || payment.status === "requires_action"),
    },
  };
}

export interface VisitPricingState {
  /** null means no service_visit_pricing row exists yet for this visit — nothing to show. */
  totalAmount: number | null;
  /**
   * True once the visit has completed AND its pricing is confirmed — i.e.
   * ready for the customer's Final Total review/tip/payment
   * (getVisitPaymentReviewAction is safe to call). Pay Per Cleaning has no
   * separate price-change approval step (owner-approved product decision,
   * 2026-09-26): the customer's own explicit Pay action on Final Total is
   * the sole authorization point, so this is a plain readiness check, never
   * an approval gate.
   */
  readyForPayment: boolean;
}

/**
 * Read-only pre-check the customer-facing payment screen calls BEFORE
 * attempting a full payment review, so a not-yet-ready visit (cleaning not
 * done yet) renders a clear "not ready yet" message instead of surfacing
 * prepareVisitPaymentReview's generic InvalidVisitStateError.
 */
export async function getVisitPricingStateAction(serviceVisitId: string): Promise<PaymentActionResult<VisitPricingState>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  const visit = await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  const pricing = await repo.findServiceVisitPricingByVisitId(serviceVisitId);
  if (!pricing) {
    return { ok: true, data: { totalAmount: null, readyForPayment: false } };
  }
  return {
    ok: true,
    data: {
      totalAmount: pricing.totalAmount,
      readyForPayment: visit.status === "completed" && pricing.priceStatus === "confirmed",
    },
  };
}

export interface PreviewFinalTotalTipResult {
  tipAmount: number;
  taxAmount: number;
  totalAmount: number;
  requiresConfirmation: boolean;
}

/**
 * Read-only, never-persisted preview of tax+tip for a visit whose pricing
 * is not yet 'confirmed' — prepareVisitPaymentReview/selectVisitTip both
 * hard-gate on 'confirmed' pricing and would persist a service_visit_payments
 * row keyed to an amount that could still change before it is, so this
 * deliberately duplicates their tax-preview math (resolveTipBasisAmount +
 * resolveTipAmount + a throwaway Stripe Tax Calculation) without ever
 * writing anything. Not currently called by any client screen — Pay Per
 * Cleaning's Final Total flow only ever reaches the customer once pricing
 * is already confirmed (see finalize-and-send.ts) — but kept as a safe,
 * correct preview utility for any other not-yet-confirmed row.
 */
export async function previewFinalTotalTipAction(
  serviceVisitId: string,
  tipSelectionType: TipSelectionType,
  customAmount?: number
): Promise<PaymentActionResult<PreviewFinalTotalTipResult>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  const visit = await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  const pricing = await repo.findServiceVisitPricingByVisitId(serviceVisitId);
  if (!pricing) {
    return { ok: false, error: "No pricing estimate available yet for this visit." };
  }

  try {
    const tipBasisAmount = await resolveTipBasisAmount(repo, visit, pricing);
    const { tipAmount, requiresConfirmation } = resolveTipAmount({ tipSelectionType, tipBasisAmount, customAmount });

    const collectibleTotal = pricing.amountDueFromCustomer + tipAmount;
    if (collectibleTotal <= 0) {
      return { ok: true, data: { tipAmount, taxAmount: 0, totalAmount: collectibleTotal, requiresConfirmation } };
    }

    const gateway = createStripeVisitPaymentGateway();
    const calculation = await gateway.createTaxCalculation({
      serviceAmountCents: toStripeCents(pricing.amountDueFromCustomer),
      tipAmountCents: toStripeCents(tipAmount),
      address: resolveTaxLocationAddress(visit),
    });

    return {
      ok: true,
      data: {
        tipAmount,
        taxAmount: calculation.taxAmountExclusiveCents / 100,
        totalAmount: calculation.amountTotalCents / 100,
        requiresConfirmation,
      },
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * The customer's ONE "Confirm Final Total & Pay" click — see
 * confirm-final-total-and-pay.ts for the full behavior, including the
 * narrow edge case (pricing confirmed ahead of the cleaning) it still
 * handles. Not currently called by VisitPaymentFlow.tsx, which uses the
 * plain selectVisitTipAction + confirmVisitPaymentAction two-step pattern
 * instead (pricing is already confirmed by the time the customer's Final
 * Total screen appears — see finalize-and-send.ts) — kept for that edge
 * case and any future caller that needs the combined one-click behavior.
 */
export async function confirmFinalTotalAndPayAction(
  serviceVisitId: string,
  tipSelectionType?: TipSelectionType,
  customAmount?: number
): Promise<PaymentActionResult<ConfirmFinalTotalAndPayOutcome>> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);

  try {
    const outcome = await confirmFinalTotalAndPay(repo, createSupabaseBookingRepository(), createStripeVisitPaymentGateway(), {
      serviceVisitId,
      customerId: session.customerId,
      tipSelectionType,
      customAmount,
    });
    revalidatePath("/my/payments");
    return { ok: true, data: outcome };
  } catch (error) {
    return toErrorResult(error);
  }
}

function extractZip(serviceAddressIdentity: string | null): string {
  const zip = serviceAddressIdentity?.split("|")[0];
  return zip && /^\d{5}$/.test(zip) ? zip : "";
}
