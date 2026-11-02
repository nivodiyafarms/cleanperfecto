import "server-only";

import { normalizeReferralCode } from "./codes";
import { createSupabaseReferralRepository } from "./supabase-referral-repository";

const MESSAGES: Record<string, string> = {
  UNKNOWN_CODE: "That referral code isn't active.",
  INACTIVE_CODE: "That referral code isn't active.",
  SELF_REFERRAL: "You can't use your own referral code.",
  NOT_NEW_CUSTOMER: "Referral rewards are for a new customer's first cleaning.",
};

export async function referralFieldsForBooking(input: {
  code?: string | null;
  storedCode?: string | null;
  customerId: string;
  friendEmail: string | null;
  friendPhone: string | null;
  householdKey: string | null;
  friendHasCompletedService: boolean;
  friendPaymentMethodId: string | null;
  quoteRequestId: string;
  agreedQuoteInvitationId?: string | null;
}): Promise<{ ok: true; referralCodeId: string | null; referralId: string | null } | { ok: false; message: string }> {
  let code: string | null = null;
  if (input.code?.trim()) {
    code = normalizeReferralCode(input.code);
    if (!code) return { ok: false, message: MESSAGES.UNKNOWN_CODE };
  } else if (input.storedCode?.trim()) {
    code = normalizeReferralCode(input.storedCode);
    if (!code) return { ok: false, message: MESSAGES.UNKNOWN_CODE };
  }
  if (!code) return { ok: true, referralCodeId: null, referralId: null };

  const result = await createSupabaseReferralRepository().attribute({
    code,
    friendCustomerId: input.customerId,
    friendEmail: input.friendEmail,
    friendPhone: input.friendPhone,
    householdKey: input.householdKey,
    friendHasCompletedService: input.friendHasCompletedService,
    friendPaymentMethodId: input.friendPaymentMethodId,
    quoteRequestId: input.quoteRequestId,
    agreedQuoteInvitationId: input.agreedQuoteInvitationId ?? null,
    bookingOrderId: null,
  });
  if (!result.ok) return { ok: false, message: MESSAGES[result.reason] ?? MESSAGES.UNKNOWN_CODE };
  return { ok: true, referralCodeId: result.referralCodeId, referralId: result.referralId };
}

export async function attachReferralFromCheckout(
  input: Omit<Parameters<typeof referralFieldsForBooking>[0], "friendPaymentMethodId"> & {
    loadPaymentMethodId: () => Promise<string | null>;
  }
): Promise<{ ok: true; referralCodeId: string | null; referralId: string | null } | { ok: false; message: string }> {
  if (!input.code?.trim() && !input.storedCode?.trim()) {
    return { ok: true, referralCodeId: null, referralId: null };
  }
  const { loadPaymentMethodId, ...rest } = input;
  return referralFieldsForBooking({ ...rest, friendPaymentMethodId: await loadPaymentMethodId() });
}

export async function linkReferralAfterBooking(referralId: string | null, bookingOrderId: string): Promise<void> {
  if (!referralId) return;
  try {
    await createSupabaseReferralRepository().linkReferralToBooking(referralId, bookingOrderId);
  } catch {
    console.error("[referrals] booking link failed");
  }
}
