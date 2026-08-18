import "server-only";

import type { CustomerLookupRepository, CustomerRecord } from "./customer-repository";

export type CustomerIdentityConflictReason =
  /** Normalized email matches one customer and normalized phone matches a different one. */
  | "EMAIL_AND_PHONE_MATCH_DIFFERENT_CUSTOMERS"
  /** More than one existing customer already shares this normalized email — customers has no UNIQUE constraint, so this is possible even though resolveCustomer never causes it. */
  | "MULTIPLE_CUSTOMERS_SHARE_EMAIL"
  /** Same as above, for normalized phone. */
  | "MULTIPLE_CUSTOMERS_SHARE_PHONE";

/**
 * Which identifier(s) actually produced the match — drives the safer
 * per-field contact-refresh rules in contact-refresh.ts. "email_and_phone"
 * is Case A (both point to the same customer); "email_only"/"phone_only"
 * are Cases B/C respectively, including when the other contact method
 * simply wasn't supplied on this submission.
 */
export type CustomerMatchKind = "email_and_phone" | "email_only" | "phone_only";

export type ResolveCustomerResult =
  | { outcome: "matched"; customer: CustomerRecord; matchedBy: CustomerMatchKind }
  | { outcome: "created"; customer: CustomerRecord }
  | { outcome: "conflict"; reason: CustomerIdentityConflictReason; conflictingCustomerIds: string[] };

export interface ResolveCustomerInput {
  name: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  phoneNormalized: string | null;
}

/**
 * Server-only. Approved logic (CLAUDE.md resolveCustomer rule):
 *   A. normalized email AND normalized phone both match the SAME customer -> reuse
 *   B. only normalized email matches -> reuse
 *   C. only normalized phone matches -> reuse
 *   D. neither matches -> create
 *   E. normalized email matches Customer A AND normalized phone matches
 *      Customer B -> IDENTITY_CONFLICT, never merge, never pick one
 * If only one contact method was supplied, only that identifier's matches
 * are considered (the other is skipped entirely, not treated as "no match").
 *
 * Never exposes another customer's PII beyond the CustomerRecord shape
 * (id/name/contact fields) already scoped to matched/created customers.
 */
export async function resolveCustomer(
  input: ResolveCustomerInput,
  repo: CustomerLookupRepository
): Promise<ResolveCustomerResult> {
  const emailMatches = input.emailNormalized ? await repo.findByEmailNormalized(input.emailNormalized) : [];
  const phoneMatches = input.phoneNormalized ? await repo.findByPhoneNormalized(input.phoneNormalized) : [];

  if (emailMatches.length > 1) {
    return {
      outcome: "conflict",
      reason: "MULTIPLE_CUSTOMERS_SHARE_EMAIL",
      conflictingCustomerIds: emailMatches.map((customer) => customer.id),
    };
  }

  if (phoneMatches.length > 1) {
    return {
      outcome: "conflict",
      reason: "MULTIPLE_CUSTOMERS_SHARE_PHONE",
      conflictingCustomerIds: phoneMatches.map((customer) => customer.id),
    };
  }

  const emailMatch = emailMatches[0] ?? null;
  const phoneMatch = phoneMatches[0] ?? null;

  if (emailMatch && phoneMatch) {
    if (emailMatch.id === phoneMatch.id) {
      return { outcome: "matched", customer: emailMatch, matchedBy: "email_and_phone" }; // Case A
    }
    return {
      outcome: "conflict",
      reason: "EMAIL_AND_PHONE_MATCH_DIFFERENT_CUSTOMERS",
      conflictingCustomerIds: [emailMatch.id, phoneMatch.id],
    }; // Case E
  }

  if (emailMatch) {
    return { outcome: "matched", customer: emailMatch, matchedBy: "email_only" }; // Case B
  }

  if (phoneMatch) {
    return { outcome: "matched", customer: phoneMatch, matchedBy: "phone_only" }; // Case C
  }

  const created = await repo.createCustomer({
    name: input.name,
    email: input.email,
    emailNormalized: input.emailNormalized,
    phone: input.phone,
    phoneNormalized: input.phoneNormalized,
  });
  return { outcome: "created", customer: created }; // Case D
}
