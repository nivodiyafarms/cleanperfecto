import "server-only";

import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DurationEstimateInput } from "@/lib/scheduling/duration-engine";
import type { CalculationInput } from "@/lib/pricing/types";

/**
 * Derives the scope (cleaning type / size tier / condition / rooms) needed
 * by estimateDuration() for a visit that hasn't been confirmed yet, by
 * reading it back from the ORIGINAL booking_orders.pricing_snapshot.input
 * (via the existing booking repository) — never re-collected or guessed.
 * A normal-booking visit has bookingOrderId set directly; a package visit
 * only has prepaidPackageId, so its originating booking order is resolved
 * one hop through prepaid_packages.booking_order_id first.
 */
export async function resolveDurationInputForVisit(visit: {
  bookingOrderId: string | null;
  prepaidPackageId: string | null;
}): Promise<DurationEstimateInput | null> {
  let bookingOrderId = visit.bookingOrderId;

  if (!bookingOrderId && visit.prepaidPackageId) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("prepaid_packages")
      .select("booking_order_id")
      .eq("id", visit.prepaidPackageId)
      .maybeSingle();
    if (error) {
      throw new Error(`[admin] prepaid_package booking_order_id lookup failed: ${error.message}`);
    }
    bookingOrderId = data?.booking_order_id ?? null;
  }

  if (!bookingOrderId) {
    return null;
  }

  const bookingRepo = createSupabaseBookingRepository();
  const bookingOrder = await bookingRepo.findBookingOrderById(bookingOrderId);
  if (!bookingOrder) {
    return null;
  }

  const input = bookingOrder.pricingSnapshot.input;
  return {
    cleaningType: input.cleaningType,
    sizeTier: input.sizeTier,
    condition: input.condition,
    rooms: input.rooms,
  };
}

export interface PackageSchedulingContext {
  customerId: string;
  cleaningType: CalculationInput["cleaningType"];
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
  calculationInput: CalculationInput;
}

/**
 * Everything schedulePackageVisitPlan / createPackageAmendment need for one
 * package — customer, cleaning type, and the original service address —
 * all read back from the package's originating booking_orders row, never
 * re-collected or guessed.
 */
export async function resolvePackageSchedulingContext(prepaidPackageId: string): Promise<PackageSchedulingContext | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("prepaid_packages")
    .select("customer_id,booking_order_id")
    .eq("id", prepaidPackageId)
    .maybeSingle();
  if (error) {
    throw new Error(`[admin] prepaid_package lookup failed: ${error.message}`);
  }
  if (!data?.booking_order_id) {
    return null;
  }

  const bookingRepo = createSupabaseBookingRepository();
  const bookingOrder = await bookingRepo.findBookingOrderById(data.booking_order_id);
  if (!bookingOrder) {
    return null;
  }

  return {
    customerId: data.customer_id,
    cleaningType: bookingOrder.cleaningType,
    serviceAddressLine1: bookingOrder.serviceAddressLine1,
    serviceAddressLine2: bookingOrder.serviceAddressLine2,
    serviceCity: bookingOrder.serviceCity,
    serviceState: bookingOrder.serviceState,
    serviceAddressIdentity: bookingOrder.serviceAddressIdentity,
    calculationInput: bookingOrder.pricingSnapshot.input,
  };
}
