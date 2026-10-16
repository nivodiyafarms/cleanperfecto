import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  AgreedQuoteInvitationRepository,
  AgreedQuoteInvitationRow,
  AgreedQuoteInvitationSendRow,
  AgreedQuoteInvitationSummary,
  NewAgreedQuoteInvitationRow,
} from "./agreed-quote-invitation-repository";

function toInvitationRow(row: Record<string, unknown>): AgreedQuoteInvitationRow {
  return {
    id: row.id as string,
    quoteRequestId: row.quote_request_id as string,
    customerId: row.customer_id as string,
    createdByAdminUserId: row.created_by_admin_user_id as string,
    status: row.status as AgreedQuoteInvitationRow["status"],
    clientRequestId: row.client_request_id as string,
    negotiationChannel: (row.negotiation_channel as AgreedQuoteInvitationRow["negotiationChannel"]) ?? null,
    negotiationNotes: (row.negotiation_notes as string | null) ?? null,
    agreedRequestedDate: (row.agreed_requested_date as string | null) ?? null,
    agreedRequestedStartTime: (row.agreed_requested_start_time as string | null) ?? null,
    resendCount: row.resend_count as number,
    lastSentAt: (row.last_sent_at as string | null) ?? null,
    expiresAt: row.expires_at as string,
    renewCount: row.renew_count as number,
    renewedAt: (row.renewed_at as string | null) ?? null,
    renewedByAdminUserId: (row.renewed_by_admin_user_id as string | null) ?? null,
    supersedesInvitationId: (row.supersedes_invitation_id as string | null) ?? null,
    supersededAt: (row.superseded_at as string | null) ?? null,
    bookingOrderId: (row.booking_order_id as string | null) ?? null,
    checkoutStartedAt: (row.checkout_started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancelledByAdminUserId: (row.cancelled_by_admin_user_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Production Supabase-backed implementation of AgreedQuoteInvitationRepository.
 * Every genuinely concurrency-sensitive operation (checkout claim,
 * cancellation, send rate-limiting) delegates to its own atomic RPC —
 * never a read-then-write from this layer. Summary joins are done as
 * separate round-trip queries rather than embedded PostgREST selects, same
 * convention as the rest of this codebase's repositories.
 */
export function createSupabaseAgreedQuoteInvitationRepository(): AgreedQuoteInvitationRepository {
  const supabase = createSupabaseAdminClient();

  async function buildSummary(invitation: AgreedQuoteInvitationRow): Promise<AgreedQuoteInvitationSummary | null> {
    const [{ data: quote, error: quoteError }, { data: customer, error: customerError }] = await Promise.all([
      supabase.from("quote_requests").select("cleaning_type, pricing_snapshot").eq("id", invitation.quoteRequestId).maybeSingle(),
      supabase.from("customers").select("name, email").eq("id", invitation.customerId).maybeSingle(),
    ]);
    if (quoteError) throw new Error(`[agreed-quote] quote_requests lookup failed: ${quoteError.message}`);
    if (customerError) throw new Error(`[agreed-quote] customers lookup failed: ${customerError.message}`);
    if (!quote || !customer) return null;

    return {
      ...invitation,
      customerName: customer.name,
      customerEmail: customer.email,
      cleaningType: quote.cleaning_type,
      calculationInput: quote.pricing_snapshot.input,
      calculationResult: quote.pricing_snapshot.result,
    };
  }

  return {
    async insertAgreedQuoteInvitation(row: NewAgreedQuoteInvitationRow): Promise<AgreedQuoteInvitationRow> {
      const { data, error } = await supabase
        .from("agreed_quote_invitations")
        .insert({
          quote_request_id: row.quoteRequestId,
          customer_id: row.customerId,
          created_by_admin_user_id: row.createdByAdminUserId,
          client_request_id: row.clientRequestId,
          negotiation_channel: row.negotiationChannel,
          negotiation_notes: row.negotiationNotes,
          agreed_requested_date: row.agreedRequestedDate,
          agreed_requested_start_time: row.agreedRequestedStartTime,
          expires_at: row.expiresAt,
          supersedes_invitation_id: row.supersedesInvitationId,
        })
        .select()
        .single();
      if (error || !data) {
        throw new Error(`[agreed-quote] invitation insert failed: ${error?.message ?? "no row returned"}`);
      }
      return toInvitationRow(data);
    },

    async findAgreedQuoteInvitationById(id: string): Promise<AgreedQuoteInvitationRow | null> {
      const { data, error } = await supabase.from("agreed_quote_invitations").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[agreed-quote] invitation lookup failed: ${error.message}`);
      return data ? toInvitationRow(data) : null;
    },

    async findAgreedQuoteInvitationSummaryById(id: string): Promise<AgreedQuoteInvitationSummary | null> {
      const { data, error } = await supabase.from("agreed_quote_invitations").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[agreed-quote] invitation lookup failed: ${error.message}`);
      if (!data) return null;
      return buildSummary(toInvitationRow(data));
    },

    async listAgreedQuoteInvitationSummaries(): Promise<AgreedQuoteInvitationSummary[]> {
      const { data, error } = await supabase.from("agreed_quote_invitations").select().order("created_at", { ascending: false });
      if (error) throw new Error(`[agreed-quote] invitation list failed: ${error.message}`);
      const summaries = await Promise.all((data ?? []).map((row) => buildSummary(toInvitationRow(row))));
      return summaries.filter((s): s is AgreedQuoteInvitationSummary => s !== null);
    },

    async supersedeAgreedQuoteInvitation(oldInvitationId: string, now: Date): Promise<AgreedQuoteInvitationRow | null> {
      const { data, error } = await supabase
        .from("agreed_quote_invitations")
        .update({ status: "superseded", superseded_at: now.toISOString() })
        .eq("id", oldInvitationId)
        .in("status", ["pending_send", "sent"])
        .select()
        .maybeSingle();
      if (error) throw new Error(`[agreed-quote] invitation supersede failed: ${error.message}`);
      return data ? toInvitationRow(data) : null;
    },

    async claimAgreedQuoteInvitationSend(
      invitationId: string,
      idempotencyKey: string,
      now: Date,
      cooldownSeconds: number,
      rateLimitWindowSeconds: number,
      rateLimitMax: number
    ): Promise<AgreedQuoteInvitationSendRow> {
      const { data, error } = await supabase
        .rpc("claim_agreed_quote_invitation_send", {
          p_invitation_id: invitationId,
          p_idempotency_key: idempotencyKey,
          p_now: now.toISOString(),
          p_cooldown_seconds: cooldownSeconds,
          p_rate_limit_window_seconds: rateLimitWindowSeconds,
          p_rate_limit_max: rateLimitMax,
        })
        .single();
      if (error) throw new Error(error.message);
      const row = data as { id: string; invitation_id: string; idempotency_key: string; status: AgreedQuoteInvitationSendRow["status"]; failure_reason: string | null };
      return { id: row.id, invitationId: row.invitation_id, idempotencyKey: row.idempotency_key, status: row.status, failureReason: row.failure_reason };
    },

    async markAgreedQuoteInvitationSendSent(sendId: string): Promise<void> {
      const { error } = await supabase.from("agreed_quote_invitation_sends").update({ status: "sent" }).eq("id", sendId);
      if (error) throw new Error(`[agreed-quote] send ledger mark-sent failed: ${error.message}`);
    },

    async markAgreedQuoteInvitationSendFailedTerminal(sendId: string, failureReason: string): Promise<void> {
      const { error } = await supabase
        .from("agreed_quote_invitation_sends")
        .update({ status: "failed_terminal", failure_reason: failureReason })
        .eq("id", sendId);
      if (error) throw new Error(`[agreed-quote] send ledger mark-failed failed: ${error.message}`);
    },

    async recordAgreedQuoteInvitationSent(invitationId: string, nextResendCount: number, sentAt: Date): Promise<void> {
      // Counters are bumped regardless of which sendable status the
      // invitation is currently in — filtered to the three non-terminal
      // statuses so this can never revive a cancelled/superseded/completed
      // row. Status itself only ever moves pending_send -> sent (a second
      // filtered update, so a resend on an already-'sent' or
      // 'checkout_in_progress' row simply doesn't match and leaves status
      // untouched — never regressed backward). expires_at is deliberately
      // never written here.
      const { error: bumpError } = await supabase
        .from("agreed_quote_invitations")
        .update({ resend_count: nextResendCount, last_sent_at: sentAt.toISOString() })
        .eq("id", invitationId)
        .in("status", ["pending_send", "sent", "checkout_in_progress"]);
      if (bumpError) throw new Error(`[agreed-quote] invitation send-record failed: ${bumpError.message}`);

      const { error: transitionError } = await supabase
        .from("agreed_quote_invitations")
        .update({ status: "sent" })
        .eq("id", invitationId)
        .eq("status", "pending_send");
      if (transitionError) throw new Error(`[agreed-quote] invitation status transition failed: ${transitionError.message}`);
    },

    async renewAgreedQuoteInvitation(
      invitationId: string,
      nextExpiresAt: Date,
      nextRenewCount: number,
      renewedAt: Date,
      renewedByAdminUserId: string
    ): Promise<AgreedQuoteInvitationRow | null> {
      const { data, error } = await supabase
        .from("agreed_quote_invitations")
        .update({
          expires_at: nextExpiresAt.toISOString(),
          renew_count: nextRenewCount,
          renewed_at: renewedAt.toISOString(),
          renewed_by_admin_user_id: renewedByAdminUserId,
        })
        .eq("id", invitationId)
        .in("status", ["pending_send", "sent", "checkout_in_progress"])
        .select()
        .maybeSingle();
      if (error) throw new Error(`[agreed-quote] invitation renew failed: ${error.message}`);
      return data ? toInvitationRow(data) : null;
    },

    async linkAgreedQuoteInvitationBookingOrder(invitationId: string, bookingOrderId: string): Promise<AgreedQuoteInvitationRow | null> {
      const { data, error } = await supabase
        .from("agreed_quote_invitations")
        .update({ booking_order_id: bookingOrderId })
        .eq("id", invitationId)
        .eq("status", "checkout_in_progress")
        .or(`booking_order_id.is.null,booking_order_id.eq.${bookingOrderId}`)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[agreed-quote] invitation booking-order link failed: ${error.message}`);
      return data ? toInvitationRow(data) : null;
    },

    async claimAgreedQuoteInvitationCheckout(invitationId: string, customerId: string, now: Date): Promise<AgreedQuoteInvitationRow | null> {
      const { data, error } = await supabase
        .rpc("claim_agreed_quote_invitation_checkout", {
          p_invitation_id: invitationId,
          p_customer_id: customerId,
          p_now: now.toISOString(),
        })
        .maybeSingle();
      if (error) throw new Error(`[agreed-quote] checkout claim failed: ${error.message}`);
      return data ? toInvitationRow(data as Record<string, unknown>) : null;
    },

    async claimAgreedQuoteInvitationCancellation(invitationId: string, adminUserId: string, now: Date): Promise<AgreedQuoteInvitationRow | null> {
      const { data, error } = await supabase
        .rpc("claim_agreed_quote_invitation_cancellation", {
          p_invitation_id: invitationId,
          p_admin_user_id: adminUserId,
          p_now: now.toISOString(),
        })
        .maybeSingle();
      if (error) throw new Error(`[agreed-quote] cancellation claim failed: ${error.message}`);
      return data ? toInvitationRow(data as Record<string, unknown>) : null;
    },

    async markAgreedQuoteInvitationCompletedByBookingOrderId(bookingOrderId: string, completedAt: Date): Promise<void> {
      const { error } = await supabase
        .from("agreed_quote_invitations")
        .update({ status: "completed", completed_at: completedAt.toISOString() })
        .eq("booking_order_id", bookingOrderId)
        .eq("status", "checkout_in_progress");
      if (error) throw new Error(`[agreed-quote] invitation completion hook failed: ${error.message}`);
    },

    async hasLivePaymentAttemptForBookingOrder(bookingOrderId: string | null): Promise<boolean> {
      if (!bookingOrderId) return false;
      const { data, error } = await supabase
        .from("payment_attempts")
        .select("id")
        .eq("booking_order_id", bookingOrderId)
        .in("status", ["created", "processing"])
        .limit(1);
      if (error) throw new Error(`[agreed-quote] live payment-attempt check failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
