import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ConsentState = "sent" | "viewed" | "declined" | "signed";

/**
 * How a 'signed' row's acceptance was actually captured — see the
 * acceptance_method column comment (20260827090400 migration). clickwrap:
 * a required checkbox, signedName populated from customers.name, never
 * typed by the customer. typed_signature: the customer typed their own
 * legal name (sign-consent.ts) — authored but currently unreachable from
 * any live caller.
 */
export type ConsentAcceptanceMethod = "clickwrap" | "typed_signature";

export interface ConsentVersionRecord {
  id: string;
  versionLabel: string;
  title: string;
  bodyText: string;
  isLegallyReviewed: boolean;
  isActive: boolean;
}

export interface CustomerConsentRecord {
  id: string;
  customerId: string;
  consentVersionId: string;
  serviceVisitId: string | null;
  state: ConsentState;
  sentAt: Date;
  viewedAt: Date | null;
  declinedAt: Date | null;
  signedAt: Date | null;
  acceptedTextSnapshot: string | null;
  signedName: string | null;
  /** Null until signed (state='sent'/'viewed'/'declined'); always populated once state='signed' — see ConsentAcceptanceMethod. */
  acceptanceMethod: ConsentAcceptanceMethod | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** Path/hash of the retained signed-document PDF (private signed-consents Storage bucket). Both null until generated; set together, exactly once. */
  signedDocumentPath: string | null;
  signedDocumentSha256: string | null;
}

export interface SignConsentInput {
  signedName: string;
  /** The frozen, exact text of the SINGLE agreement being accepted — no per-clause acceptance, this is all-or-nothing. */
  acceptedTextSnapshot: string;
  /**
   * How this specific call is capturing acceptance. Optional — defaults to
   * 'clickwrap' (the only path with a live caller today) when omitted, so
   * this stays additive against every pre-existing caller/test. The two
   * real domain callers (accept-consent-clickwrap.ts, sign-consent.ts)
   * always pass it explicitly rather than relying on the default, so a raw
   * DB row is never ambiguous about which mechanism actually ran.
   */
  acceptanceMethod?: ConsentAcceptanceMethod;
  /** Supplemental audit evidence only — never required. */
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Abstraction over consent_versions/customer_consents — its own small
 * repository, same "customer-portal-adjacent concern gets its own
 * repository" convention as CustomerNotificationPreferencesRepository,
 * rather than folded into SchedulingRepository (which owns the
 * notification ledger but has no business owning consent state).
 */
export interface ConsentRepository {
  findActiveVersion(): Promise<ConsentVersionRecord | null>;
  findVersionById(id: string): Promise<ConsentVersionRecord | null>;
  findByCustomerAndVersion(customerId: string, consentVersionId: string): Promise<CustomerConsentRecord | null>;
  /** Newest first — for the portal history view and admin display. */
  listByCustomerId(customerId: string): Promise<CustomerConsentRecord[]>;
  findById(id: string): Promise<CustomerConsentRecord | null>;
  /** The customer's name of record (customers.name) — used only to populate the existing signed_name evidence column for a clickwrap acceptance; never a typed/handwritten signature. Null if the customer row is somehow missing. */
  findCustomerNameById(customerId: string): Promise<string | null>;
  /**
   * Insert-or-no-op via the unique (customer_id, consent_version_id)
   * constraint — the idempotency mechanism for "don't re-request a
   * consent already in flight or signed for this version." `inserted`
   * tells the caller whether to also enqueue the notification.
   */
  insertSentRequest(input: { customerId: string; consentVersionId: string; serviceVisitId: string | null }): Promise<{ inserted: boolean; record: CustomerConsentRecord }>;
  /** sent -> viewed only; a no-op if already viewed/declined/signed. */
  markViewed(id: string): Promise<void>;
  /** sent/viewed -> declined; refuses (throws) if already signed. */
  markDeclined(id: string): Promise<CustomerConsentRecord>;
  /** sent/viewed/declined -> signed, freezing the evidence fields; refuses (throws) if already signed (idempotent double-submit protection handled by the caller checking state first). Accepting is all-or-nothing — there is no per-clause signature. */
  sign(id: string, input: SignConsentInput): Promise<CustomerConsentRecord>;
  /**
   * Sets signed_document_path/signed_document_sha256 on an already-signed
   * row — the one narrow update allowed after signing (see the migration's
   * immutability trigger). Only succeeds when the row is signed AND the
   * document fields are still null; refuses (throws) otherwise, whether
   * because the row isn't signed yet or a document was already recorded —
   * this is what makes an authorized retry after a failed generation safe
   * (a successful prior attempt can never be silently overwritten).
   */
  setSignedDocument(id: string, document: { path: string; sha256: string }): Promise<CustomerConsentRecord>;
}

function toVersionRecord(row: Record<string, unknown>): ConsentVersionRecord {
  return {
    id: row.id as string,
    versionLabel: row.version_label as string,
    title: row.title as string,
    bodyText: row.body_text as string,
    isLegallyReviewed: row.is_legally_reviewed as boolean,
    isActive: row.is_active as boolean,
  };
}

function toConsentRecord(row: Record<string, unknown>): CustomerConsentRecord {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    consentVersionId: row.consent_version_id as string,
    serviceVisitId: (row.service_visit_id as string | null) ?? null,
    state: row.state as ConsentState,
    sentAt: new Date(row.sent_at as string),
    viewedAt: row.viewed_at ? new Date(row.viewed_at as string) : null,
    declinedAt: row.declined_at ? new Date(row.declined_at as string) : null,
    signedAt: row.signed_at ? new Date(row.signed_at as string) : null,
    acceptedTextSnapshot: (row.accepted_text_snapshot as string | null) ?? null,
    signedName: (row.signed_name as string | null) ?? null,
    acceptanceMethod: (row.acceptance_method as ConsentAcceptanceMethod | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    signedDocumentPath: (row.signed_document_path as string | null) ?? null,
    signedDocumentSha256: (row.signed_document_sha256 as string | null) ?? null,
  };
}

export function createSupabaseConsentRepository(): ConsentRepository {
  const supabase = createSupabaseAdminClient();

  return {
    async findActiveVersion() {
      const { data, error } = await supabase.from("consent_versions").select().eq("is_active", true).maybeSingle();
      if (error) throw new Error(`[consent] active consent_versions lookup failed: ${error.message}`);
      return data ? toVersionRecord(data) : null;
    },

    async findVersionById(id) {
      const { data, error } = await supabase.from("consent_versions").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[consent] consent_versions lookup failed: ${error.message}`);
      return data ? toVersionRecord(data) : null;
    },

    async findByCustomerAndVersion(customerId, consentVersionId) {
      const { data, error } = await supabase
        .from("customer_consents")
        .select()
        .eq("customer_id", customerId)
        .eq("consent_version_id", consentVersionId)
        .maybeSingle();
      if (error) throw new Error(`[consent] customer_consents lookup failed: ${error.message}`);
      return data ? toConsentRecord(data) : null;
    },

    async listByCustomerId(customerId) {
      const { data, error } = await supabase.from("customer_consents").select().eq("customer_id", customerId).order("sent_at", { ascending: false });
      if (error) throw new Error(`[consent] customer_consents list failed: ${error.message}`);
      return (data ?? []).map(toConsentRecord);
    },

    async findById(id) {
      const { data, error } = await supabase.from("customer_consents").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[consent] customer_consents lookup by id failed: ${error.message}`);
      return data ? toConsentRecord(data) : null;
    },

    async findCustomerNameById(customerId) {
      const { data, error } = await supabase.from("customers").select("name").eq("id", customerId).maybeSingle();
      if (error) throw new Error(`[consent] customers name lookup failed: ${error.message}`);
      return (data?.name as string | undefined) ?? null;
    },

    async insertSentRequest(input) {
      const { data, error } = await supabase
        .from("customer_consents")
        .upsert(
          { customer_id: input.customerId, consent_version_id: input.consentVersionId, service_visit_id: input.serviceVisitId, state: "sent" },
          { onConflict: "customer_id,consent_version_id", ignoreDuplicates: true }
        )
        .select()
        .maybeSingle();
      if (error) throw new Error(`[consent] customer_consents insert failed: ${error.message}`);
      if (data) return { inserted: true, record: toConsentRecord(data) };

      const existing = await supabase.from("customer_consents").select().eq("customer_id", input.customerId).eq("consent_version_id", input.consentVersionId).single();
      if (existing.error || !existing.data) throw new Error(`[consent] customer_consents lookup after conflict failed: ${existing.error?.message}`);
      return { inserted: false, record: toConsentRecord(existing.data) };
    },

    async markViewed(id) {
      const { error } = await supabase.from("customer_consents").update({ state: "viewed", viewed_at: new Date().toISOString() }).eq("id", id).eq("state", "sent");
      if (error) throw new Error(`[consent] marking consent viewed failed: ${error.message}`);
    },

    async markDeclined(id) {
      const { data, error } = await supabase
        .from("customer_consents")
        .update({ state: "declined", declined_at: new Date().toISOString() })
        .eq("id", id)
        .in("state", ["sent", "viewed"])
        .select()
        .maybeSingle();
      if (error) throw new Error(`[consent] marking consent declined failed: ${error.message}`);
      if (!data) throw new Error(`[consent] customer_consents ${id} not in a declinable state`);
      return toConsentRecord(data);
    },

    async sign(id, input) {
      const { data, error } = await supabase
        .from("customer_consents")
        .update({
          state: "signed",
          signed_at: new Date().toISOString(),
          signed_name: input.signedName,
          accepted_text_snapshot: input.acceptedTextSnapshot,
          acceptance_method: input.acceptanceMethod ?? "clickwrap",
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .eq("id", id)
        .in("state", ["sent", "viewed", "declined"])
        .select()
        .maybeSingle();
      if (error) throw new Error(`[consent] signing consent failed: ${error.message}`);
      if (!data) throw new Error(`[consent] customer_consents ${id} not in a signable state`);
      return toConsentRecord(data);
    },

    async setSignedDocument(id, document) {
      const { data, error } = await supabase
        .from("customer_consents")
        .update({ signed_document_path: document.path, signed_document_sha256: document.sha256 })
        .eq("id", id)
        .eq("state", "signed")
        .is("signed_document_path", null)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[consent] setting signed document failed: ${error.message}`);
      if (!data) throw new Error(`[consent] customer_consents ${id} not eligible for a signed-document update (not signed, or a document is already recorded)`);
      return toConsentRecord(data);
    },
  };
}
