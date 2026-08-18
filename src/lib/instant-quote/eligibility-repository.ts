/**
 * Abstraction over service_visits (status = 'completed') lookups, so
 * checkFirstCleaningEligibility stays testable without a real Supabase
 * connection. See supabase-repository.ts for the production implementation,
 * which queries service_visits directly by service_address_identity — never
 * via quote_request_id (a visit may exist with no linked quote at all).
 */
export interface CompletedServiceHistoryRepository {
  hasCompletedVisitByEmail(emailNormalized: string): Promise<boolean>;
  hasCompletedVisitByPhone(phoneNormalized: string): Promise<boolean>;
  hasCompletedVisitByAddress(serviceAddressIdentity: string): Promise<boolean>;
}
