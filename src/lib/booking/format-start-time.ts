/**
 * Formats booking_orders.requested_start_time ("HH:MM" or "HH:MM:SS", the
 * shape Postgres returns for a `time` column) into a friendly 12-hour
 * label, e.g. "09:00" -> "9:00 AM". Returns null when there's nothing to
 * format — callers fall back to legacy requestedTimeWindow copy or a
 * generic message, never inventing a time.
 */
export function formatRequestedStartTime(startTime: string | null): string | null {
  if (!startTime) return null;
  const match = /^(\d{2}):(\d{2})/.exec(startTime);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}
