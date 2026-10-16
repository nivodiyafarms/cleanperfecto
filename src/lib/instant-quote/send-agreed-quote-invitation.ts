import "server-only";

import type { CustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import { sendNotificationEmailWithRetry } from "@/lib/notifications/send-notification-with-retry";
import type { AgreedQuoteInvitationRepository, AgreedQuoteInvitationRow } from "./agreed-quote-invitation-repository";
import {
  AGREED_QUOTE_INVITATION_SEND_COOLDOWN_SECONDS,
  AGREED_QUOTE_INVITATION_SEND_RATE_LIMIT_MAX,
  AGREED_QUOTE_INVITATION_SEND_RATE_LIMIT_WINDOW_SECONDS,
  AGREED_QUOTE_INVITATION_VALIDITY_DAYS,
} from "./agreed-quote-constants";
import { buildAgreedQuoteInvitationEmail } from "./build-agreed-quote-invitation-email";

export interface SendAgreedQuoteInvitationDeps {
  invitationRepo: AgreedQuoteInvitationRepository;
  authLinkGenerator: CustomerAuthLinkGenerator;
  emailSender: NotificationEmailSender;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export type SendAgreedQuoteInvitationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "invalid_state" | "customer_missing_email" | "link_generation_failed" | "send_failed" | "duplicate_request" | "rate_limited";
    };

const SENDABLE_STATUSES: AgreedQuoteInvitationRow["status"][] = ["pending_send", "sent", "checkout_in_progress"];

function formatAgreedPriceLabel(input: { isPrepaidPackage: boolean; calculatedTotal: number; visitCount: number }): string {
  const formatted = `$${input.calculatedTotal.toFixed(2)}`;
  return input.isPrepaidPackage ? `${formatted} for ${input.visitCount} prepaid visits` : formatted;
}

/**
 * One function, two callers (sendAgreedQuoteInvitationAction's first send/
 * resend, and renewAgreedQuoteInvitation below) — mirrors
 * requestFreshPaymentLink's claim/send/retry shape. NEVER touches
 * expires_at — that's exclusively renewAgreedQuoteInvitation's job.
 */
export async function sendAgreedQuoteInvitation(deps: SendAgreedQuoteInvitationDeps, invitationId: string): Promise<SendAgreedQuoteInvitationResult> {
  const now = deps.now ?? (() => new Date());

  const invitation = await deps.invitationRepo.findAgreedQuoteInvitationById(invitationId);
  if (!invitation) return { ok: false, reason: "not_found" };
  if (!SENDABLE_STATUSES.includes(invitation.status)) return { ok: false, reason: "invalid_state" };

  const summary = await deps.invitationRepo.findAgreedQuoteInvitationSummaryById(invitationId);
  if (!summary) return { ok: false, reason: "not_found" };
  if (!summary.customerEmail) return { ok: false, reason: "customer_missing_email" };

  const nowValue = now();
  const idempotencyKey = `${invitationId}:send:${nowValue.getTime()}`;

  let claimId: string;
  try {
    const claim = await deps.invitationRepo.claimAgreedQuoteInvitationSend(
      invitationId,
      idempotencyKey,
      nowValue,
      AGREED_QUOTE_INVITATION_SEND_COOLDOWN_SECONDS,
      AGREED_QUOTE_INVITATION_SEND_RATE_LIMIT_WINDOW_SECONDS,
      AGREED_QUOTE_INVITATION_SEND_RATE_LIMIT_MAX
    );
    claimId = claim.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate_request")) return { ok: false, reason: "duplicate_request" };
    if (message.includes("rate_limited")) return { ok: false, reason: "rate_limited" };
    throw error;
  }

  const link = await deps.authLinkGenerator.generate(summary.customerEmail, `/my/agreed-quote/${invitationId}`);
  if (!link.ok) {
    await deps.invitationRepo.markAgreedQuoteInvitationSendFailedTerminal(claimId, link.reason);
    return { ok: false, reason: "link_generation_failed" };
  }

  const content = buildAgreedQuoteInvitationEmail({
    customerName: summary.customerName,
    agreedPriceLabel: formatAgreedPriceLabel({
      isPrepaidPackage: summary.calculationInput.isPrepaidPackage,
      calculatedTotal: summary.calculationInput.isPrepaidPackage ? (summary.calculationResult.prepaidPackageTotal ?? summary.calculationResult.calculatedTotal) : summary.calculationResult.calculatedTotal,
      visitCount: summary.calculationInput.visitCount,
    }),
    authenticatedLink: link.actionLink,
  });

  const sendResult = await sendNotificationEmailWithRetry(
    {
      emailSender: deps.emailSender,
      markSent: deps.invitationRepo.markAgreedQuoteInvitationSendSent,
      markFailedTerminal: deps.invitationRepo.markAgreedQuoteInvitationSendFailedTerminal,
      sleep: deps.sleep,
    },
    claimId,
    { to: summary.customerEmail, subject: content.subject, text: content.text, html: content.html, idempotencyKey }
  );
  if (!sendResult.ok) {
    return { ok: false, reason: "send_failed" };
  }

  await deps.invitationRepo.recordAgreedQuoteInvitationSent(invitationId, invitation.resendCount + 1, nowValue);
  return { ok: true };
}

export type RenewAgreedQuoteInvitationResult = SendAgreedQuoteInvitationResult;

/**
 * The explicit, deliberate staff action for an expired (or soon-expiring)
 * offer — pushes expires_at forward to a fresh window, then immediately
 * sends a fresh link/email via the same primitive above. The caller
 * (renewAgreedQuoteInvitationAction) is responsible for requiring the UI's
 * own "I've reviewed the price and availability" confirmation before
 * calling this — that confirmation is a UI/action-layer concern, never
 * re-derived from system state here.
 */
export async function renewAgreedQuoteInvitation(
  deps: SendAgreedQuoteInvitationDeps,
  invitationId: string,
  renewedByAdminUserId: string
): Promise<RenewAgreedQuoteInvitationResult> {
  const now = deps.now ?? (() => new Date());
  const nowValue = now();

  const invitation = await deps.invitationRepo.findAgreedQuoteInvitationById(invitationId);
  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status === "completed" || invitation.status === "cancelled" || invitation.status === "superseded") {
    return { ok: false, reason: "invalid_state" };
  }

  const nextExpiresAt = new Date(nowValue.getTime() + AGREED_QUOTE_INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const renewed = await deps.invitationRepo.renewAgreedQuoteInvitation(invitationId, nextExpiresAt, invitation.renewCount + 1, nowValue, renewedByAdminUserId);
  if (!renewed) {
    return { ok: false, reason: "invalid_state" };
  }

  return sendAgreedQuoteInvitation(deps, invitationId);
}
