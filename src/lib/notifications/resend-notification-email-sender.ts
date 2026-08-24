import "server-only";

import { createResendClient } from "@/lib/email/resend";
import { SITE_CONTACT } from "@/lib/site-contact";
import type { NotificationEmailSender, NotificationEmailSendResult } from "./email-sender";

const FROM_ADDRESS = "CleanPerfecto <notifications@cleanperfecto.com>";

/**
 * Production Resend-backed NotificationEmailSender. Passes the
 * notification's own deterministic idempotency_key straight through as
 * Resend's Idempotency-Key header (resend's SDK supports this as a second
 * options argument to emails.send) — a retried dispatcher attempt for the
 * SAME ledger row can never cause Resend to send a second physical email,
 * even if our own DB state transition somehow re-runs the send before
 * marking it 'sent' (belt-and-suspenders on top of the claim/state-machine
 * idempotency already provided by the ledger itself).
 */
export function createResendNotificationEmailSender(): NotificationEmailSender {
  return {
    async send(input): Promise<NotificationEmailSendResult> {
      let resend: ReturnType<typeof createResendClient>;
      try {
        resend = createResendClient();
      } catch {
        return { sent: false, failureReason: "resend client unavailable (missing RESEND_API_KEY?)" };
      }

      try {
        const result = await resend.emails.send(
          { from: FROM_ADDRESS, to: input.to, subject: input.subject, text: input.text, html: input.html, replyTo: SITE_CONTACT.email },
          { idempotencyKey: input.idempotencyKey }
        );

        if (result.error) {
          return { sent: false, failureReason: `${result.error.name ?? "unknown"}: ${result.error.message ?? "unknown"}` };
        }
        return { sent: true, providerMessageId: result.data?.id ?? null };
      } catch (err) {
        return { sent: false, failureReason: err instanceof Error ? err.message : "unknown error" };
      }
    },
  };
}
