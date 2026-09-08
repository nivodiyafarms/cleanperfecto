import { randomUUID } from "node:crypto";
import type { ConsentRepository, ConsentVersionRecord, CustomerConsentRecord } from "../consent-repository";

export interface FakeConsentRepositoryOptions {
  versions?: ConsentVersionRecord[];
  /** customerId -> name, for findCustomerNameById. */
  customerNames?: Record<string, string>;
}

export interface FakeConsentRepositoryState {
  versions: Map<string, ConsentVersionRecord>;
  consents: Map<string, CustomerConsentRecord>;
  customerNames: Map<string, string>;
}

const DEFAULT_VERSION: ConsentVersionRecord = {
  id: "version-1",
  versionLabel: "CP-CONSENT-2026-01",
  title: "CleanPerfecto Service Consent Agreement",
  bodyText: "TEST CONSENT TEXT — single unified agreement covering service authorization, photo/video & marketing use, and yard sign permission.",
  isLegallyReviewed: false,
  isActive: true,
};

/** In-memory ConsentRepository for unit tests — mirrors createFakeSchedulingRepository's { repo, state } shape. */
export function createFakeConsentRepository(options: FakeConsentRepositoryOptions = {}): { repo: ConsentRepository; state: FakeConsentRepositoryState } {
  const versions = new Map<string, ConsentVersionRecord>();
  for (const v of options.versions ?? [DEFAULT_VERSION]) versions.set(v.id, v);
  const consents = new Map<string, CustomerConsentRecord>();
  const customerNames = new Map<string, string>(Object.entries(options.customerNames ?? {}));

  function keyOf(customerId: string, consentVersionId: string) {
    return `${customerId}:${consentVersionId}`;
  }

  const repo: ConsentRepository = {
    async findActiveVersion() {
      for (const v of versions.values()) if (v.isActive) return v;
      return null;
    },
    async findVersionById(id) {
      return versions.get(id) ?? null;
    },
    async findByCustomerAndVersion(customerId, consentVersionId) {
      return consents.get(keyOf(customerId, consentVersionId)) ?? null;
    },
    async listByCustomerId(customerId) {
      return [...consents.values()].filter((c) => c.customerId === customerId).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
    },
    async findById(id) {
      for (const c of consents.values()) if (c.id === id) return c;
      return null;
    },
    async findCustomerNameById(customerId) {
      return customerNames.get(customerId) ?? null;
    },
    async insertSentRequest(input) {
      const key = keyOf(input.customerId, input.consentVersionId);
      const existing = consents.get(key);
      if (existing) return { inserted: false, record: existing };
      const record: CustomerConsentRecord = {
        id: randomUUID(),
        customerId: input.customerId,
        consentVersionId: input.consentVersionId,
        serviceVisitId: input.serviceVisitId,
        state: "sent",
        sentAt: new Date(),
        viewedAt: null,
        declinedAt: null,
        signedAt: null,
        acceptedTextSnapshot: null,
        signedName: null,
        acceptanceMethod: null,
        ipAddress: null,
        userAgent: null,
        signedDocumentPath: null,
        signedDocumentSha256: null,
      };
      consents.set(key, record);
      return { inserted: true, record };
    },
    async markViewed(id) {
      for (const c of consents.values()) {
        if (c.id === id && c.state === "sent") {
          c.state = "viewed";
          c.viewedAt = new Date();
        }
      }
    },
    async markDeclined(id) {
      for (const c of consents.values()) {
        if (c.id === id && (c.state === "sent" || c.state === "viewed")) {
          c.state = "declined";
          c.declinedAt = new Date();
          return c;
        }
      }
      throw new Error(`[fake-consent] customer_consents ${id} not in a declinable state`);
    },
    async sign(id, input) {
      for (const c of consents.values()) {
        if (c.id === id && (c.state === "sent" || c.state === "viewed" || c.state === "declined")) {
          c.state = "signed";
          c.signedAt = new Date();
          c.signedName = input.signedName;
          c.acceptedTextSnapshot = input.acceptedTextSnapshot;
          c.acceptanceMethod = input.acceptanceMethod ?? "clickwrap";
          c.ipAddress = input.ipAddress;
          c.userAgent = input.userAgent;
          return c;
        }
      }
      throw new Error(`[fake-consent] customer_consents ${id} not in a signable state`);
    },
    async setSignedDocument(id, document) {
      for (const c of consents.values()) {
        if (c.id === id && c.state === "signed" && c.signedDocumentPath === null) {
          c.signedDocumentPath = document.path;
          c.signedDocumentSha256 = document.sha256;
          return c;
        }
      }
      throw new Error(`[fake-consent] customer_consents ${id} not eligible for a signed-document update (not signed, or a document is already recorded)`);
    },
  };

  return { repo, state: { versions, consents, customerNames } };
}
