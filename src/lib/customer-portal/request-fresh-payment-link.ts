import "server-only";

import { buildNotificationContent } from "@/lib/notifications/notification-content";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { CustomerAuthLinkGenerator } from "./customer-auth-link";

export type RequestFreshPaymentLinkResult =
  | { ok: true }
  | { ok: false; reason: "visit_not_found" | "not_payable" | "no_email_on_file" | "link_generation_failed" | "send_failed" };

export interface RequestFreshPaymentLinkDeps {
  repo: SchedulingRepository;
  contactLookup: (customerId: string) => Promise<NotificationRecipientContact | null>;
  authLinkGenerator: CustomerAuthLinkGenerator;
  emailSender: NotificationEmailSender;
}

/**
 * Customer-initiated resend of a Final Total one-click payment link, from
 * the UNAUTHENTICATED /my/payment-link-expired page — the customer has no
 * session and no password; this IS the recovery path when their original
 * link expired or was already used.
 *
 * Deliberately NOT routed through the service_visit_notifications ledger
 * (dispatch-due-notifications.ts): that ledger's idempotency key is keyed
 * to (visit, amount) specifically to stop an automated re-enqueue from
 * sending the SAME final total twice — exactly the case a customer
 * explicitly asking for a new link needs to bypass, not be blocked by. This
 * is a direct send instead.
 *
 * Unlike the dispatcher, this never falls back to a plain (login-required)
 * link on generation failure — the entire point of this action is handing
 * back a one-click link; a plain link would only return the customer to
 * this same expired-link page.
 *
 * The caller (the server action backing the page) is responsible for never
 * surfacing WHICH failure reason occurred to the unauthenticated client —
 * only "sent" or "something went wrong" — so this cannot be used to probe
 * which visit ids exist or are payable. No rate limiting exists yet; this
 * is a known, accepted gap for the initial version, not an oversight.
 */
export async function requestFreshPaymentLink(deps: RequestFreshPaymentLinkDeps, serviceVisitId: string): Promise<RequestFreshPaymentLinkResult> {
  const visit = await deps.repo.findServiceVisitById(serviceVisitId);
  if (!visit) return { ok: false, reason: "visit_not_found" };

  const pricing = await deps.repo.findServiceVisitPricingByVisitId(serviceVisitId);
  const alreadyPaid = pricing?.paymentStatus === "paid";
  if (visit.status !== "completed" || !pricing || pricing.priceStatus !== "confirmed" || alreadyPaid) {
    return { ok: false, reason: "not_payable" };
  }

  const contact = await deps.contactLookup(visit.customerId);
  if (!contact?.email) return { ok: false, reason: "no_email_on_file" };

  const link = await deps.authLinkGenerator.generate(contact.email, `/my/payments?visit=${serviceVisitId}`);
  if (!link.ok) return { ok: false, reason: "link_generation_failed" };

  const content = buildNotificationContent({
    notificationType: "final_total_ready",
    customerName: contact.name,
    visitStartAtUtc: visit.confirmedStartAt ?? null,
    timezone: visit.timezone,
    serviceVisitId,
    authenticatedLink: link.actionLink,
  });

  const outcome = await deps.emailSender.send({
    to: contact.email,
    subject: content.subject,
    text: content.text,
    html: content.html,
    // Not the ledger's deterministic key (there is no ledger row for this
    // send) — a fresh identifier per actual resend attempt, since each one
    // IS a distinct, intentional, customer-requested physical email.
    idempotencyKey: `payment-link-resend:${serviceVisitId}:${Date.now()}`,
  });

  return outcome.sent ? { ok: true } : { ok: false, reason: "send_failed" };
}
