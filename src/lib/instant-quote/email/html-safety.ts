/**
 * Escapes a value for safe interpolation into HTML email bodies. Controls
 * markup injection only — server-side format validation (validate-input.ts)
 * controls shape/length, but never guarantees a customer-submitted string
 * is free of HTML-significant characters (e.g. name/address/message have
 * no character-set restriction, only length limits). Every customer-
 * controlled value interpolated into an HTML string in this module must be
 * passed through this first. Never applied to the plain-text email body —
 * plain text has no markup to inject, and escaping it would show the
 * recipient literal "&lt;" instead of "<". Never mutates what's stored in
 * Supabase; this is a rendering-time concern only.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strips CR/LF from a value before it's used in an email header field
 * (currently: the admin email subject, which interpolates the customer's
 * raw submitted name). Email headers are newline-delimited; an unescaped
 * CR/LF in a header value is the classic header-injection vector (e.g.
 * smuggling a fake "Bcc:" line). Not an HTML concern — see escapeHtml
 * above for that — and not applied to the email body, only to values used
 * to build a header-field string like Subject.
 */
export function sanitizeForEmailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
