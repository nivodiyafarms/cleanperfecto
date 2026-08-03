import "server-only";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses QUOTE_NOTIFICATION_EMAILS into a de-duplicated list of valid
 * recipient addresses. Invalid or empty entries are dropped silently; the
 * caller is responsible for logging when the resulting list is empty.
 */
export function parseQuoteNotificationRecipients(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0 || !EMAIL_PATTERN.test(trimmed)) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    recipients.push(trimmed);
  }

  return recipients;
}
