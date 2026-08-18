import type { CustomerLookupRepository } from "./customer-repository";
import type { CompletedServiceHistoryRepository } from "./eligibility-repository";
import type { QuoteRequestRow } from "./build-quote-request-row";

export type InsertQuoteRequestResult = { ok: true } | { ok: false; error: string };

/**
 * Everything submit-instant-quote.ts needs from persistence, combined into
 * one interface so the orchestrator takes a single injected dependency. See
 * supabase-repository.ts for the production implementation.
 */
export interface InstantQuoteRepository extends CustomerLookupRepository, CompletedServiceHistoryRepository {
  insertQuoteRequest(row: QuoteRequestRow): Promise<InsertQuoteRequestResult>;
}
