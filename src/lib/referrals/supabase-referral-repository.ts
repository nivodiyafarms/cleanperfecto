import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allocateCustomerReferralCode, generateReferralCode, ReferralCodeCollision } from "./codes";

export interface CustomerReferralSummary {
  code: string | null;
  credits: { id: string; amount: number; expiresAt: string; status: string; role: string }[];
}

export interface AdminReferralSnapshot {
  codes: {
    id: string;
    code: string;
    codeType: string;
    active: boolean;
    referrerCustomerId: string | null;
    recipientLabel: string | null;
  }[];
  referrals: {
    id: string;
    codeType: string;
    referredCustomerId: string;
    qualifyingServiceVisitId: string | null;
    status: string;
    reviewFlags: string[];
    quoteRequestId: string | null;
    bookingOrderId: string | null;
  }[];
  credits: {
    id: string;
    beneficiaryCustomerId: string;
    beneficiaryRole: string;
    amount: number;
    issuedAt: string;
    expiresAt: string;
    status: string;
    referralId: string;
  }[];
  redemptions: {
    id: string;
    serviceVisitId: string;
    amount: number;
    status: string;
    eligibleCleaningAmount: number;
    referralCreditId: string;
  }[];
  audits: {
    id: string;
    actionType: string;
    targetId: string;
    reason: string | null;
    createdAt: string;
    previousValue: string | null;
    newValue: string | null;
  }[];
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function createSupabaseReferralRepository() {
  const supabase = createSupabaseAdminClient();

  return {
    async issueCustomerCode(customerId: string): Promise<string> {
      const allocated = await allocateCustomerReferralCode({
        findExisting: async () => {
          const { data, error } = await supabase
            .from("referral_codes")
            .select("code")
            .eq("referrer_customer_id", customerId)
            .eq("code_type", "customer")
            .maybeSingle();
          if (error) throw new Error("[referrals] code lookup failed");
          return data ? { code: data.code as string } : null;
        },
        tryInsert: async (code) => {
          const { data, error } = await supabase.rpc("create_customer_referral_code", {
            p_customer_id: customerId,
            p_code: code,
          });
          if (error) {
            if (error.message.includes("REFERRAL_CODE_COLLISION")) throw new ReferralCodeCollision();
            throw new Error("[referrals] code create failed");
          }
          const payload = data as { code?: string } | null;
          if (!payload?.code) throw new Error("[referrals] code create failed");
          return { code: payload.code };
        },
      });
      return allocated.code;
    },

    async issueAdminCode(adminUserId: string, recipientLabel: string | null): Promise<string> {
      const allocated = await allocateCustomerReferralCode({
        findExisting: async () => null,
        generate: generateReferralCode,
        tryInsert: async (code) => {
          const { data, error } = await supabase.rpc("create_admin_referral_code_with_label", {
            p_admin_user_id: adminUserId,
            p_code: code,
            p_recipient_label: recipientLabel,
          });
          if (error) {
            if (error.message.includes("REFERRAL_CODE_COLLISION")) throw new ReferralCodeCollision();
            throw new Error("[referrals] admin code create failed");
          }
          const payload = data as { code?: string } | null;
          if (!payload?.code) throw new Error("[referrals] admin code create failed");
          return { code: payload.code };
        },
      });
      return allocated.code;
    },

    async referralCodeType(codeId: string): Promise<string | null> {
      const { data, error } = await supabase.from("referral_codes").select("code_type").eq("id", codeId).maybeSingle();
      if (error) throw new Error("[referrals] code lookup failed");
      return (data?.code_type as string | undefined) ?? null;
    },

    async updateRecipientLabel(codeId: string, adminUserId: string, recipientLabel: string | null): Promise<void> {
      const { error } = await supabase.rpc("update_admin_referral_code_recipient_label", {
        p_code_id: codeId,
        p_admin_user_id: adminUserId,
        p_recipient_label: recipientLabel,
      });
      if (error) throw new Error("[referrals] recipient label update failed");
    },

    async setCodeActive(codeId: string, active: boolean, adminUserId: string, reason: string | null): Promise<void> {
      const { error } = await supabase.rpc("set_referral_code_active", {
        p_code_id: codeId,
        p_active: active,
        p_admin_user_id: adminUserId,
        p_reason: reason,
      });
      if (error) throw new Error("[referrals] code update failed");
    },

    async attribute(input: {
      code: string;
      friendCustomerId: string;
      friendEmail: string | null;
      friendPhone: string | null;
      householdKey: string | null;
      friendHasCompletedService: boolean;
      friendPaymentMethodId: string | null;
      quoteRequestId: string | null;
      agreedQuoteInvitationId: string | null;
      bookingOrderId: string | null;
    }): Promise<
      | { ok: true; referralId: string; referralCodeId: string }
      | { ok: false; reason: string }
    > {
      const { data, error } = await supabase.rpc("attribute_referral", {
        p_code: input.code,
        p_friend_customer_id: input.friendCustomerId,
        p_friend_email: input.friendEmail,
        p_friend_phone: input.friendPhone,
        p_household_key: input.householdKey,
        p_friend_has_completed_service: input.friendHasCompletedService,
        p_friend_payment_method_id: input.friendPaymentMethodId,
        p_quote_request_id: input.quoteRequestId,
        p_agreed_quote_invitation_id: input.agreedQuoteInvitationId,
        p_booking_order_id: input.bookingOrderId,
      });
      if (error) throw new Error("[referrals] attribution failed");
      const payload = data as { ok?: boolean; reason?: string; referralId?: string; referralCodeId?: string } | null;
      if (!payload?.ok || !payload.referralId || !payload.referralCodeId) {
        return { ok: false, reason: payload?.reason ?? "UNKNOWN_CODE" };
      }
      return { ok: true, referralId: payload.referralId, referralCodeId: payload.referralCodeId };
    },

    async linkReferralToBooking(referralId: string, bookingOrderId: string): Promise<void> {
      const { error } = await supabase.from("referrals").update({ booking_order_id: bookingOrderId }).eq("id", referralId);
      if (error) throw new Error("[referrals] booking link failed");
    },

    async syncQualification(serviceVisitId: string): Promise<void> {
      const { error } = await supabase.rpc("sync_referral_qualification", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error("[referrals] qualification sync failed");
    },

    async previewCredit(serviceVisitId: string): Promise<number> {
      const { data, error } = await supabase.rpc("preview_referral_credit", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error("[referrals] preview failed");
      return asNumber(data);
    },

    async reserveCredit(serviceVisitId: string): Promise<number> {
      const { data, error } = await supabase.rpc("reserve_referral_credit", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error("[referrals] reserve failed");
      return asNumber(data);
    },

    async consumeRedemption(serviceVisitId: string): Promise<void> {
      const { error } = await supabase.rpc("consume_referral_redemption", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error("[referrals] consume failed");
    },

    async restoreRedemption(serviceVisitId: string): Promise<void> {
      const { error } = await supabase.rpc("restore_referral_redemption", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error("[referrals] restore failed");
    },

    async reverseForVisit(serviceVisitId: string): Promise<void> {
      const { error } = await supabase.rpc("reverse_referral_for_visit", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error("[referrals] reversal failed");
    },

    async flagSharedPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
      const { error } = await supabase.rpc("flag_shared_payment_method", {
        p_customer_id: customerId,
        p_payment_method_id: paymentMethodId,
      });
      if (error) throw new Error("[referrals] shared-payment flag failed");
    },

    async customerSummary(customerId: string): Promise<CustomerReferralSummary> {
      const [{ data: codeRow, error: codeError }, { data: creditRows, error: creditError }] = await Promise.all([
        supabase
          .from("referral_codes")
          .select("code")
          .eq("referrer_customer_id", customerId)
          .eq("code_type", "customer")
          .eq("active", true)
          .maybeSingle(),
        supabase
          .from("referral_credits")
          .select("id, amount, expires_at, status, beneficiary_role")
          .eq("beneficiary_customer_id", customerId)
          .eq("status", "available")
          .order("expires_at", { ascending: true }),
      ]);
      if (codeError || creditError) throw new Error("[referrals] customer summary failed");
      return {
        code: (codeRow?.code as string | undefined) ?? null,
        credits: (creditRows ?? []).map((row) => ({
          id: row.id as string,
          amount: asNumber(row.amount),
          expiresAt: row.expires_at as string,
          status: row.status as string,
          role: row.beneficiary_role as string,
        })),
      };
    },

    async adminSnapshot(): Promise<AdminReferralSnapshot> {
      const [codes, labels, referrals, creditRows, redemptionRows, audits] = await Promise.all([
        supabase.from("referral_codes").select("id, code, code_type, active, referrer_customer_id").order("created_at", { ascending: false }),
        supabase.from("referral_code_recipient_labels").select("code_id, recipient_label"),
        supabase
          .from("referrals")
          .select("id, referred_customer_id, qualifying_service_visit_id, status, review_flags, quote_request_id, booking_order_id, referral_code_id")
          .order("created_at", { ascending: false }),
        supabase.from("referral_credits").select("id, beneficiary_customer_id, beneficiary_role, amount, issued_at, expires_at, status, referral_id").order("issued_at", { ascending: false }),
        supabase.from("referral_redemptions").select("id, service_visit_id, amount, status, eligible_cleaning_amount, referral_credit_id").order("created_at", { ascending: false }),
        supabase
          .from("referral_program_audit")
          .select("id, action_type, target_id, reason, created_at, previous_value, new_value")
          .order("created_at", { ascending: false }),
      ]);
      if (codes.error || labels.error || referrals.error || creditRows.error || redemptionRows.error || audits.error) {
        throw new Error("[referrals] admin snapshot failed");
      }
      const codeTypeById = new Map((codes.data ?? []).map((row) => [row.id as string, row.code_type as string]));
      const labelByCodeId = new Map(
        (labels.data ?? []).map((row) => [row.code_id as string, (row.recipient_label as string | null) ?? null]),
      );
      return {
        codes: (codes.data ?? []).map((row) => ({
          id: row.id as string,
          code: row.code as string,
          codeType: row.code_type as string,
          active: row.active as boolean,
          referrerCustomerId: (row.referrer_customer_id as string | null) ?? null,
          recipientLabel: labelByCodeId.get(row.id as string) ?? null,
        })),
        referrals: (referrals.data ?? []).map((row) => ({
          id: row.id as string,
          codeType: codeTypeById.get(row.referral_code_id as string) ?? "customer",
          referredCustomerId: row.referred_customer_id as string,
          qualifyingServiceVisitId: (row.qualifying_service_visit_id as string | null) ?? null,
          status: row.status as string,
          reviewFlags: (row.review_flags as string[]) ?? [],
          quoteRequestId: (row.quote_request_id as string | null) ?? null,
          bookingOrderId: (row.booking_order_id as string | null) ?? null,
        })),
        credits: (creditRows.data ?? []).map((row) => ({
          id: row.id as string,
          beneficiaryCustomerId: row.beneficiary_customer_id as string,
          beneficiaryRole: row.beneficiary_role as string,
          amount: asNumber(row.amount),
          issuedAt: row.issued_at as string,
          expiresAt: row.expires_at as string,
          status: row.status as string,
          referralId: row.referral_id as string,
        })),
        redemptions: (redemptionRows.data ?? []).map((row) => ({
          id: row.id as string,
          serviceVisitId: row.service_visit_id as string,
          amount: asNumber(row.amount),
          status: row.status as string,
          eligibleCleaningAmount: asNumber(row.eligible_cleaning_amount),
          referralCreditId: row.referral_credit_id as string,
        })),
        audits: (audits.data ?? []).map((row) => ({
          id: row.id as string,
          actionType: row.action_type as string,
          targetId: row.target_id as string,
          reason: (row.reason as string | null) ?? null,
          createdAt: row.created_at as string,
          previousValue: (row.previous_value as string | null) ?? null,
          newValue: (row.new_value as string | null) ?? null,
        })),
      };
    },
  };
}
