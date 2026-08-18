/**
 * Trims and lowercases a raw email for identity matching. Deliberately not
 * more aggressive (e.g. no Gmail dot-removal) — see CLAUDE.md's approved
 * resolveCustomer rule, which only ever compares this normalized form.
 */
export function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}
