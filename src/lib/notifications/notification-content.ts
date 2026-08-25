import { utcToZonedDateTime } from "@/lib/scheduling/timezone";
import type { ServiceVisitNotificationType } from "@/lib/scheduling/types";
import { buildPortalLink } from "./portal-link";
import { getGoogleReviewUrl } from "./google-review-url";

export interface NotificationContentInput {
  notificationType: ServiceVisitNotificationType;
  customerName: string;
  /** The visit's confirmed start instant, UTC — null when not yet/no longer available (renders a generic "your upcoming cleaning" phrase instead of a specific date/time). Also null for consent_required, which is never visit-specific. */
  visitStartAtUtc: Date | null;
  /** The visit's OWN timezone (service_visits.timezone) — never hardcoded, per the DFW-today-but-not-forever requirement. */
  timezone: string;
}

export interface NotificationContent {
  subject: string;
  text: string;
  html: string;
  smsBody: string;
}

const PORTAL_PATH_BY_TYPE: Partial<Record<ServiceVisitNotificationType, string>> = {
  reminder_24h: "/my/cleanings",
  appointment_confirmed: "/my/cleanings",
  rescheduled: "/my/cleanings",
  cancelled: "/my/cleanings",
  // Payments V1: completion always routes to the Review Charges -> Tip ->
  // Confirm & Pay flow, never back to the plain cleanings list — every
  // completed visit goes through this, even a $0-due prepaid tip-only case.
  completed: "/my/payments",
  pricing_approval_required: "/my/payments",
  consent_required: "/my/consent",
  consent_reminder: "/my/consent",
  payment_succeeded: "/my/payments",
  payment_failed: "/my/payments",
  payment_action_required: "/my/payments",
  // review_request deliberately absent — its link is the external Google
  // review URL (see getGoogleReviewUrl), never a portal path.
};

const COPY_BY_TYPE: Record<ServiceVisitNotificationType, { subject: string; line: (when: string) => string }> = {
  reminder_24h: { subject: "Reminder: your cleaning is tomorrow", line: (when) => `This is a reminder that your cleaning is scheduled for ${when}.` },
  appointment_confirmed: { subject: "Your cleaning is confirmed", line: (when) => `Your cleaning is confirmed for ${when}.` },
  rescheduled: { subject: "Your cleaning has been rescheduled", line: (when) => `Your cleaning has been rescheduled to ${when}.` },
  cancelled: { subject: "Your cleaning has been cancelled", line: (when) => `Your cleaning scheduled for ${when} has been cancelled.` },
  completed: {
    subject: "Your cleaning is complete — Review & Pay",
    line: (when) => `Your cleaning on ${when} is complete. Please review your charges and complete payment when you're ready.`,
  },
  pricing_approval_required: {
    subject: "Action needed: approve your updated price",
    line: () => "Your cleaning's price has increased and needs your approval before it can be confirmed.",
  },
  consent_required: {
    subject: "Action needed: sign your CleanPerfecto service authorization",
    line: () => "Please review and sign your CleanPerfecto service authorization before your first cleaning.",
  },
  consent_reminder: {
    subject: "Reminder: your service authorization is still unsigned",
    line: () => "Your cleaning is coming up and your CleanPerfecto service authorization is still unsigned.",
  },
  review_request: {
    subject: "How did we do?",
    line: () => "Thank you for choosing CleanPerfecto! If you have a moment, we'd really appreciate a quick review.",
  },
  payment_succeeded: {
    subject: "Payment received",
    line: () => "Your payment has been received. Thank you!",
  },
  payment_failed: {
    subject: "Payment could not be completed",
    line: () => "We weren't able to complete your payment. Please review and try again.",
  },
  payment_action_required: {
    subject: "Payment needs your attention",
    line: () => "Your bank requires additional verification to complete this payment. Please finish the secure authentication step.",
  },
};

function formatVisitWhen(visitStartAtUtc: Date | null, timezone: string): string {
  if (!visitStartAtUtc) return "your upcoming cleaning";
  const { date, time } = utcToZonedDateTime(visitStartAtUtc, timezone);
  return `${date} at ${time}`;
}

/**
 * Builds all channel content for one notification. Deterministic given its
 * input for every type EXCEPT review_request, which also reads the
 * configured Google review URL (see getGoogleReviewUrl) — mirrors
 * buildPortalLink's own existing convention of reading site configuration
 * internally rather than threading it through every caller. Throws if
 * review_request content is requested with no URL configured, so the
 * dispatcher's existing try/catch routes it through the normal failed/
 * retry path rather than ever sending a broken or missing link.
 */
export function buildNotificationContent(input: NotificationContentInput): NotificationContent {
  const when = formatVisitWhen(input.visitStartAtUtc, input.timezone);
  const { subject, line: buildLine } = COPY_BY_TYPE[input.notificationType];
  const line = buildLine(when);
  const greeting = `Hi ${input.customerName},`;

  let link: string;
  if (input.notificationType === "review_request") {
    const googleReviewUrl = getGoogleReviewUrl();
    if (!googleReviewUrl) {
      throw new Error("GOOGLE_REVIEW_URL is not configured — refusing to build review_request content with no destination.");
    }
    link = googleReviewUrl;
  } else {
    link = buildPortalLink(PORTAL_PATH_BY_TYPE[input.notificationType] ?? "/my");
  }

  const LINK_LABEL_BY_TYPE: Partial<Record<ServiceVisitNotificationType, string>> = {
    review_request: "Leave a review",
    completed: "Review & Pay",
    pricing_approval_required: "Review & Pay",
    payment_succeeded: "View payment",
    payment_failed: "Review & Pay",
    payment_action_required: "Review & Pay",
  };
  const linkLabel = LINK_LABEL_BY_TYPE[input.notificationType] ?? "View details";

  return {
    subject,
    text: `${greeting}\n\n${line}\n\n${linkLabel}: ${link}`,
    html: `<p>${greeting}</p><p>${line}</p><p><a href="${link}">${linkLabel}</a></p>`,
    smsBody: `CleanPerfecto: ${line} ${link}`,
  };
}
