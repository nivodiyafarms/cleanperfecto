export type NormalizePhoneResult =
  | { valid: true; e164: string }
  | { valid: false };

/**
 * Normalizes a raw U.S. phone number to E.164 (e.g. "+14695551234").
 * Approved logic only — never guesses at international numbers:
 *   - strip everything but digits
 *   - 10 digits -> prepend "1"
 *   - 11 digits beginning with "1" -> accept as-is
 *   - anything else -> { valid: false }
 * The raw submitted phone is preserved separately by callers; this function
 * never mutates or discards it.
 */
export function normalizePhone(rawPhone: string): NormalizePhoneResult {
  const digits = rawPhone.replace(/\D/g, "");

  if (digits.length === 10) {
    return { valid: true, e164: `+1${digits}` };
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return { valid: true, e164: `+${digits}` };
  }

  return { valid: false };
}
