import "server-only";

import { createSupabaseInstantQuoteRepository } from "@/lib/instant-quote/supabase-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CustomerDefaultPaymentMethodPatch, CustomerStripeInfo, BookingRepository } from "./repository";
import type {
  BookingOrderRow,
  BookingOrderStatus,
  NewBookingOrderRow,
  NewPaymentAttemptRow,
  NewPrepaidPackageRow,
  PaymentAttemptRow,
  PaymentAttemptStatusPatch,
  QuoteRequestForBookingRow,
  WebhookClaim,
} from "./types";

function toBookingOrderRow(row: Record<string, unknown>): BookingOrderRow {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    quoteRequestId: row.quote_request_id as string,
    clientRequestId: row.client_request_id as string,
    bookingType: row.booking_type as BookingOrderRow["bookingType"],
    cleaningType: row.cleaning_type as BookingOrderRow["cleaningType"],
    frequency: row.frequency as BookingOrderRow["frequency"],
    visitCount: row.visit_count as number,
    status: row.status as BookingOrderStatus,
    paymentAuthorizationAcceptedAt: (row.payment_authorization_accepted_at as string | null) ?? null,
    pricingVersion: row.pricing_version as string,
    pricingSnapshot: row.pricing_snapshot as BookingOrderRow["pricingSnapshot"],
    calculatedTotal: Number(row.calculated_total),
    displayRangeLower: row.display_range_lower === null ? null : Number(row.display_range_lower),
    displayRangeUpper: row.display_range_upper === null ? null : Number(row.display_range_upper),
    prepaidPackageTotal: row.prepaid_package_total === null ? null : Number(row.prepaid_package_total),
    effectivePricePerVisit: row.effective_price_per_visit === null ? null : Number(row.effective_price_per_visit),
    hasStartingAtPricing: row.has_starting_at_pricing as boolean,
    manualReviewReasons: (row.manual_review_reasons as string[]) ?? [],
    selectedAddOnIds: (row.selected_add_on_ids as BookingOrderRow["selectedAddOnIds"]) ?? [],
    serviceAddressLine1: (row.service_address_line1 as string | null) ?? null,
    serviceAddressLine2: (row.service_address_line2 as string | null) ?? null,
    serviceCity: (row.service_city as string | null) ?? null,
    serviceState: (row.service_state as string | null) ?? null,
    serviceAddressIdentity: (row.service_address_identity as string | null) ?? null,
    requestedDate: (row.requested_date as string | null) ?? null,
    requestedTimeWindow: (row.requested_time_window as BookingOrderRow["requestedTimeWindow"]) ?? null,
    requestedStartTime: (row.requested_start_time as string | null) ?? null,
    cancellationPolicyVersion: (row.cancellation_policy_version as string | null) ?? null,
    paymentAuthorizationTextSnapshot: (row.payment_authorization_text_snapshot as string | null) ?? null,
    consentVersionId: (row.consent_version_id as string | null) ?? null,
    cancellationPolicyTextSnapshot: (row.cancellation_policy_text_snapshot as string | null) ?? null,
  };
}

function toPaymentAttemptRow(row: Record<string, unknown>): PaymentAttemptRow {
  return {
    id: row.id as string,
    bookingOrderId: row.booking_order_id as string,
    mode: row.mode as PaymentAttemptRow["mode"],
    stripeCheckoutSessionId: row.stripe_checkout_session_id as string,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    stripeSetupIntentId: (row.stripe_setup_intent_id as string | null) ?? null,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string | null) ?? null,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency as string,
    status: row.status as PaymentAttemptRow["status"],
    paymentMethodType: (row.payment_method_type as PaymentAttemptRow["paymentMethodType"]) ?? null,
    packageSubtotalBeforeAchIncentive:
      row.package_subtotal_before_ach_incentive === null || row.package_subtotal_before_ach_incentive === undefined
        ? null
        : Number(row.package_subtotal_before_ach_incentive),
    achSavingsAmount:
      row.ach_savings_amount === null || row.ach_savings_amount === undefined ? null : Number(row.ach_savings_amount),
  };
}

/**
 * Production Supabase-backed implementation of BookingRepository.
 * Deliberately thin — the two-layer idempotency logic, pricing recompute,
 * and webhook event matrix all live in pure/orchestrator modules that take
 * this repository as an injected dependency and are unit-tested against a
 * fake one instead. First-cleaning-eligibility lookups are delegated to
 * createSupabaseInstantQuoteRepository() rather than reimplemented, so
 * booking uses the exact same trusted service_visits queries as the quote
 * pipeline.
 */
export function createSupabaseBookingRepository(): BookingRepository {
  const supabase = createSupabaseAdminClient();
  const instantQuoteRepo = createSupabaseInstantQuoteRepository();

  return {
    hasCompletedVisitByEmail: instantQuoteRepo.hasCompletedVisitByEmail,
    hasCompletedVisitByPhone: instantQuoteRepo.hasCompletedVisitByPhone,
    hasCompletedVisitByAddress: instantQuoteRepo.hasCompletedVisitByAddress,

    async findQuoteRequestById(id: string): Promise<QuoteRequestForBookingRow | null> {
      const { data, error } = await supabase
        .from("quote_requests")
        .select(
          "id,customer_id,estimate_type,cleaning_type,pricing_snapshot,email_normalized,phone_normalized,service_address_identity,service_address_line1,service_address_line2,service_city,service_state"
        )
        .eq("id", id)
        .maybeSingle();
      if (error) {
        throw new Error(`[booking] quote_requests lookup failed: ${error.message}`);
      }
      if (!data) {
        return null;
      }
      return {
        id: data.id,
        customerId: data.customer_id,
        estimateType: data.estimate_type,
        cleaningType: data.cleaning_type,
        pricingSnapshot: data.pricing_snapshot,
        emailNormalized: data.email_normalized,
        phoneNormalized: data.phone_normalized,
        serviceAddressIdentity: data.service_address_identity,
        serviceAddressLine1: data.service_address_line1,
        serviceAddressLine2: data.service_address_line2,
        serviceCity: data.service_city,
        serviceState: data.service_state,
      };
    },

    async getCustomerForStripe(customerId: string): Promise<CustomerStripeInfo | null> {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,email,phone,stripe_customer_id,stripe_default_payment_method_id,stripe_payment_method_brand,stripe_payment_method_last4")
        .eq("id", customerId)
        .maybeSingle();
      if (error) {
        throw new Error(`[booking] customers lookup failed: ${error.message}`);
      }
      if (!data) {
        return null;
      }
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        stripeCustomerId: data.stripe_customer_id,
        stripeDefaultPaymentMethodId: data.stripe_default_payment_method_id,
        stripePaymentMethodBrand: data.stripe_payment_method_brand,
        stripePaymentMethodLast4: data.stripe_payment_method_last4,
      };
    },

    async setCustomerStripeId(customerId: string, stripeCustomerId: string): Promise<void> {
      const { error } = await supabase
        .from("customers")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", customerId);
      if (error) {
        throw new Error(`[booking] setting customers.stripe_customer_id failed: ${error.message}`);
      }
    },

    async setCustomerDefaultPaymentMethod(customerId: string, patch: CustomerDefaultPaymentMethodPatch): Promise<void> {
      const { error } = await supabase
        .from("customers")
        .update({
          stripe_default_payment_method_id: patch.stripePaymentMethodId,
          stripe_payment_method_brand: patch.brand,
          stripe_payment_method_last4: patch.last4,
          stripe_payment_method_exp_month: patch.expMonth,
          stripe_payment_method_exp_year: patch.expYear,
        })
        .eq("id", customerId);
      if (error) {
        throw new Error(`[booking] setting customers default payment method failed: ${error.message}`);
      }
    },

    async insertBookingOrder(row: NewBookingOrderRow): Promise<BookingOrderRow> {
      const dbRow = {
        customer_id: row.customerId,
        quote_request_id: row.quoteRequestId,
        client_request_id: row.clientRequestId,
        booking_type: row.bookingType,
        cleaning_type: row.cleaningType,
        frequency: row.frequency,
        visit_count: row.visitCount,
        payment_authorization_accepted_at: row.paymentAuthorizationAcceptedAt,
        pricing_version: row.pricingVersion,
        pricing_snapshot: row.pricingSnapshot,
        calculated_total: row.calculatedTotal,
        display_range_lower: row.displayRangeLower,
        display_range_upper: row.displayRangeUpper,
        prepaid_package_total: row.prepaidPackageTotal,
        effective_price_per_visit: row.effectivePricePerVisit,
        has_starting_at_pricing: row.hasStartingAtPricing,
        manual_review_reasons: row.manualReviewReasons,
        selected_add_on_ids: row.selectedAddOnIds,
        service_address_line1: row.serviceAddressLine1,
        service_address_line2: row.serviceAddressLine2,
        service_city: row.serviceCity,
        service_state: row.serviceState,
        service_address_identity: row.serviceAddressIdentity,
        requested_date: row.requestedDate,
        requested_time_window: row.requestedTimeWindow,
        requested_start_time: row.requestedStartTime,
        cancellation_policy_version: row.cancellationPolicyVersion,
        payment_authorization_text_snapshot: row.paymentAuthorizationTextSnapshot ?? null,
        consent_version_id: row.consentVersionId ?? null,
        cancellation_policy_text_snapshot: row.cancellationPolicyTextSnapshot ?? null,
      };

      // Insert-or-fetch by client_request_id: `upsert` with
      // ignoreDuplicates performs INSERT ... ON CONFLICT DO NOTHING. When
      // the conflict happens (this exact submission already produced a
      // row), no row comes back from the upsert itself — fetch the
      // existing one instead. Either way, exactly one row is returned and
      // no second booking_orders row is ever created for the same token.
      const { data: inserted, error: insertError } = await supabase
        .from("booking_orders")
        .upsert(dbRow, { onConflict: "client_request_id", ignoreDuplicates: true })
        .select()
        .maybeSingle();
      if (insertError) {
        throw new Error(`[booking] booking_orders insert failed: ${insertError.message}`);
      }
      if (inserted) {
        return toBookingOrderRow(inserted);
      }

      const { data: existing, error: fetchError } = await supabase
        .from("booking_orders")
        .select()
        .eq("client_request_id", row.clientRequestId)
        .single();
      if (fetchError || !existing) {
        throw new Error(`[booking] booking_orders fetch-after-conflict failed: ${fetchError?.message ?? "no row found"}`);
      }
      return toBookingOrderRow(existing);
    },

    async findBookingOrderById(id: string): Promise<BookingOrderRow | null> {
      const { data, error } = await supabase.from("booking_orders").select().eq("id", id).maybeSingle();
      if (error) {
        throw new Error(`[booking] booking_orders lookup failed: ${error.message}`);
      }
      return data ? toBookingOrderRow(data) : null;
    },

    async updateBookingOrderStatus(
      id: string,
      expectedStatus: BookingOrderStatus,
      nextStatus: BookingOrderStatus
    ): Promise<boolean> {
      const { data, error } = await supabase
        .from("booking_orders")
        .update({ status: nextStatus })
        .eq("id", id)
        .eq("status", expectedStatus)
        .select("id");
      if (error) {
        throw new Error(`[booking] booking_orders status update failed: ${error.message}`);
      }
      return (data ?? []).length > 0;
    },

    async findActivePaymentAttempt(bookingOrderId: string) {
      const { data, error } = await supabase
        .from("payment_attempts")
        .select()
        .eq("booking_order_id", bookingOrderId)
        .in("status", ["created", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`[booking] payment_attempts active lookup failed: ${error.message}`);
      }
      return data ? toPaymentAttemptRow(data) : null;
    },

    async insertPaymentAttempt(row: NewPaymentAttemptRow): Promise<PaymentAttemptRow> {
      const { data, error } = await supabase
        .from("payment_attempts")
        .insert({
          booking_order_id: row.bookingOrderId,
          mode: row.mode,
          stripe_checkout_session_id: row.stripeCheckoutSessionId,
          stripe_customer_id: row.stripeCustomerId,
          amount: row.amount,
          payment_method_type: row.paymentMethodType,
          package_subtotal_before_ach_incentive: row.packageSubtotalBeforeAchIncentive,
          ach_savings_amount: row.achSavingsAmount,
        })
        .select()
        .single();
      if (error || !data) {
        throw new Error(`[booking] payment_attempts insert failed: ${error?.message ?? "no row returned"}`);
      }
      return toPaymentAttemptRow(data);
    },

    async findPaymentAttemptBySessionId(sessionId: string) {
      const { data, error } = await supabase
        .from("payment_attempts")
        .select()
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();
      if (error) {
        throw new Error(`[booking] payment_attempts lookup by session id failed: ${error.message}`);
      }
      return data ? toPaymentAttemptRow(data) : null;
    },

    async updatePaymentAttemptBySessionId(sessionId: string, patch: PaymentAttemptStatusPatch): Promise<void> {
      const dbPatch: Record<string, string> = { status: patch.status };
      if (patch.stripeSetupIntentId !== undefined) dbPatch.stripe_setup_intent_id = patch.stripeSetupIntentId;
      if (patch.stripePaymentIntentId !== undefined) dbPatch.stripe_payment_intent_id = patch.stripePaymentIntentId;

      const { error } = await supabase
        .from("payment_attempts")
        .update(dbPatch)
        .eq("stripe_checkout_session_id", sessionId);
      if (error) {
        throw new Error(`[booking] payment_attempts status update failed: ${error.message}`);
      }
    },

    async activatePrepaidPackage(row: NewPrepaidPackageRow): Promise<{ inserted: boolean }> {
      const { data, error } = await supabase
        .from("prepaid_packages")
        .upsert(
          {
            customer_id: row.customerId,
            booking_order_id: row.bookingOrderId,
            frequency: row.frequency,
            package_total_paid: row.packageTotalPaid,
            effective_price_per_visit: row.effectivePricePerVisit,
          },
          { onConflict: "booking_order_id", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();
      if (error) {
        throw new Error(`[booking] prepaid_packages activation failed: ${error.message}`);
      }
      return { inserted: Boolean(data) };
    },

    async claimWebhookEvent(stripeEventId: string, eventType: string, payload: unknown): Promise<WebhookClaim> {
      const { data: inserted, error: insertError } = await supabase
        .from("stripe_webhook_events")
        .upsert(
          { stripe_event_id: stripeEventId, event_type: eventType, payload, processing_status: "received" },
          { onConflict: "stripe_event_id", ignoreDuplicates: true }
        )
        .select("id,processing_status")
        .maybeSingle();
      if (insertError) {
        throw new Error(`[booking] stripe_webhook_events claim failed: ${insertError.message}`);
      }

      let eventRowId: string;
      let processingStatus: string;
      if (inserted) {
        eventRowId = inserted.id;
        processingStatus = inserted.processing_status;
      } else {
        const { data: existing, error: fetchError } = await supabase
          .from("stripe_webhook_events")
          .select("id,processing_status")
          .eq("stripe_event_id", stripeEventId)
          .single();
        if (fetchError || !existing) {
          throw new Error(`[booking] stripe_webhook_events fetch-after-conflict failed: ${fetchError?.message ?? "no row found"}`);
        }
        eventRowId = existing.id;
        processingStatus = existing.processing_status;
      }

      // 'processed' is the only true, safe no-op. 'received' or 'failed'
      // (including a row this exact call just created) must be
      // (re)processed — see the migration comments on why existence alone
      // is never sufficient.
      if (processingStatus === "processed") {
        return { shouldProcess: false, eventRowId };
      }

      const { error: markProcessingError } = await supabase
        .from("stripe_webhook_events")
        .update({ processing_status: "processing" })
        .eq("id", eventRowId);
      if (markProcessingError) {
        throw new Error(`[booking] stripe_webhook_events mark-processing failed: ${markProcessingError.message}`);
      }

      return { shouldProcess: true, eventRowId };
    },

    async markWebhookEventProcessed(eventRowId: string): Promise<void> {
      const { error } = await supabase
        .from("stripe_webhook_events")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", eventRowId);
      if (error) {
        throw new Error(`[booking] stripe_webhook_events mark-processed failed: ${error.message}`);
      }
    },

    async markWebhookEventFailed(eventRowId: string, reason: string): Promise<void> {
      const { error } = await supabase
        .from("stripe_webhook_events")
        .update({ processing_status: "failed", failure_reason: reason })
        .eq("id", eventRowId);
      if (error) {
        throw new Error(`[booking] stripe_webhook_events mark-failed failed: ${error.message}`);
      }
    },
  };
}
