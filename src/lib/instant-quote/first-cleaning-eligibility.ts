import type { CompletedServiceHistoryRepository } from "./eligibility-repository";

export type FirstCleaningEligibilityMatch = "email" | "phone" | "address";

export type FirstCleaningEligibilityResult =
  | { eligible: true }
  | { eligible: false; matchedBy: FirstCleaningEligibilityMatch[] };

export interface FirstCleaningEligibilityIdentifiers {
  emailNormalized: string | null;
  phoneNormalized: string | null;
  serviceAddressIdentity: string | null;
}

/**
 * Server-only. Eligibility MUST NOT be based on quote_requests existence —
 * a prior inquiry/quote/abandoned quote never disqualifies anyone. Only a
 * completed service_visits row counts (status = 'completed'; scheduled or
 * cancelled visits never disqualify). Address matching uses
 * service_visits.service_address_identity directly — no quote_request_id
 * join is required or used.
 *
 * The result never exposes which customer/visit matched — only which
 * identifier category did, so no other customer's data leaks through this
 * result.
 */
export async function checkFirstCleaningEligibility(
  identifiers: FirstCleaningEligibilityIdentifiers,
  repo: CompletedServiceHistoryRepository
): Promise<FirstCleaningEligibilityResult> {
  const matchedBy: FirstCleaningEligibilityMatch[] = [];

  if (identifiers.emailNormalized && (await repo.hasCompletedVisitByEmail(identifiers.emailNormalized))) {
    matchedBy.push("email");
  }

  if (identifiers.phoneNormalized && (await repo.hasCompletedVisitByPhone(identifiers.phoneNormalized))) {
    matchedBy.push("phone");
  }

  if (
    identifiers.serviceAddressIdentity &&
    (await repo.hasCompletedVisitByAddress(identifiers.serviceAddressIdentity))
  ) {
    matchedBy.push("address");
  }

  return matchedBy.length > 0 ? { eligible: false, matchedBy } : { eligible: true };
}
