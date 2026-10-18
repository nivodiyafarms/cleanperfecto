import "server-only";

import { createSupabaseAgreedQuoteInvitationRepository } from "@/lib/instant-quote/supabase-agreed-quote-invitation-repository";
import type { AgreedQuoteInvitationSummary } from "@/lib/instant-quote/agreed-quote-invitation-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function listAgreedQuoteInvitations(): Promise<AgreedQuoteInvitationSummary[]> {
  return createSupabaseAgreedQuoteInvitationRepository().listAgreedQuoteInvitationSummaries();
}

export async function getAgreedQuoteInvitationDetail(invitationId: string): Promise<AgreedQuoteInvitationSummary | null> {
  return createSupabaseAgreedQuoteInvitationRepository().findAgreedQuoteInvitationSummaryById(invitationId);
}

export interface CustomerSearchResult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Simple ILIKE search across name/email/phone — no existing admin
 * customer-search query was found to reuse. Intentionally minimal (no
 * pagination) since this backs a small "pick the right existing customer"
 * autocomplete-style flow, not a general customer directory.
 */
export async function searchCustomersByContact(query: string): Promise<CustomerSearchResult[]> {
  // PostgREST's .or() filter string is itself a mini-DSL (comma-separated
  // clauses, parenthesized groups) — strip the characters that are
  // syntactically significant to IT (never to SQL; this is unrelated to
  // SQL injection, .or() is always parameterized under the hood) so a
  // search term containing a comma or parenthesis can't alter which
  // clauses this filter actually applies.
  const sanitized = query.trim().replace(/[,()%]/g, "");
  if (!sanitized) return [];

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email, phone")
    .or(`name.ilike.%${sanitized}%,email.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
    .limit(10);
  if (error) throw new Error(`[admin] customer search failed: ${error.message}`);
  return data ?? [];
}
