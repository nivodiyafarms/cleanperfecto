import { utcToZonedDateTime } from "@/lib/scheduling/timezone";
import type { ServiceVisitNotificationType } from "@/lib/scheduling/types";
import { buildPortalLink } from "./portal-link";

export interface NotificationContentInput {
  notificationType: ServiceVisitNotificationType;
  customerName: string;
  /** The visit's confirmed start instant, UTC — null when not yet/no longer available (renders a generic "your upcoming cleaning" phrase instead of a specific date/time). */
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

const PORTAL_PATH_BY_TYPE: Record<ServiceVisitNotificationType, string> = {
  reminder_24h: "/my/cleanings",
  appointment_confirmed: "/my/cleanings",
  rescheduled: "/my/cleanings",
  cancelled: "/my/cleanings",
  completed: "/my/cleanings",
  pricing_approval_required: "/my/payments",
};

const COPY_BY_TYPE: Record<ServiceVisitNotificationType, { subject: string; line: (when: string) => string }> = {
  reminder_24h: { subject: "Reminder: your cleaning is tomorrow", line: (when) => `This is a reminder that your cleaning is scheduled for ${when}.` },
  appointment_confirmed: { subject: "Your cleaning is confirmed", line: (when) => `Your cleaning is confirmed for ${when}.` },
  rescheduled: { subject: "Your cleaning has been rescheduled", line: (when) => `Your cleaning has been rescheduled to ${when}.` },
  cancelled: { subject: "Your cleaning has been cancelled", line: (when) => `Your cleaning scheduled for ${when} has been cancelled.` },
  completed: { subject: "Your cleaning is complete", line: (when) => `Your cleaning on ${when} is complete. Thank you for choosing CleanPerfecto.` },
  pricing_approval_required: {
    subject: "Action needed: approve your updated price",
    line: () => "Your cleaning's price has increased and needs your approval before it can be confirmed.",
  },
};

function formatVisitWhen(visitStartAtUtc: Date | null, timezone: string): string {
  if (!visitStartAtUtc) return "your upcoming cleaning";
  const { date, time } = utcToZonedDateTime(visitStartAtUtc, timezone);
  return `${date} at ${time}`;
}

/** Builds all channel content for one notification — pure/deterministic given its input, no I/O. */
export function buildNotificationContent(input: NotificationContentInput): NotificationContent {
  const when = formatVisitWhen(input.visitStartAtUtc, input.timezone);
  const link = buildPortalLink(PORTAL_PATH_BY_TYPE[input.notificationType]);
  const { subject, line: buildLine } = COPY_BY_TYPE[input.notificationType];
  const line = buildLine(when);
  const greeting = `Hi ${input.customerName},`;

  return {
    subject,
    text: `${greeting}\n\n${line}\n\nView details: ${link}`,
    html: `<p>${greeting}</p><p>${line}</p><p><a href="${link}">View details</a></p>`,
    smsBody: `CleanPerfecto: ${line} ${link}`,
  };
}
