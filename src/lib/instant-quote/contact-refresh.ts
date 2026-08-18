import type { CustomerMatchKind } from "./resolve-customer";
import type { CustomerContactPatch } from "./customer-repository";

export interface ExistingCustomerContact {
  name: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  phoneNormalized: string | null;
}

export interface ContactRefreshInput {
  /** Which identifier(s) resolveCustomer actually matched on — see CustomerMatchKind. Never called for a "created" or "conflict" outcome. */
  matchedBy: CustomerMatchKind;
  existingCustomer: ExistingCustomerContact;
  /** Raw name as submitted on this quote — always present (validation requires it). */
  name: string;
  /** Raw email as submitted on this quote, or null if this submission didn't supply one. */
  email: string | null;
  emailNormalized: string | null;
  /** Raw phone as submitted on this quote, or null if this submission didn't supply one. */
  phone: string | null;
  phoneNormalized: string | null;
}

/**
 * Pure function: computes what (if anything) should change on an already
 * safely-resolved (matched) customer. quote_requests always keeps the raw
 * contact values submitted for that specific quote regardless of this
 * patch — this only concerns the customers row's "current known" contact.
 *
 * Safer, per-match-kind rules (owner-approved, supersedes an earlier
 * "always refresh everything" version):
 *
 *   - email_and_phone (Case A, both identifiers independently confirm the
 *     same customer): name/email/phone may all be refreshed from
 *     validated, non-empty submitted values.
 *   - email_only (Case B): email may be refreshed (it's the identifier
 *     that matched). Phone is only ever filled in when the existing
 *     customer's phone is currently null — a different existing non-null
 *     phone is never overwritten automatically.
 *   - phone_only (Case C): symmetrical — phone may be refreshed, email is
 *     only filled in when currently null.
 *   - In both single-identifier cases, name is only refreshed when the
 *     existing stored name is blank — a single matching identifier is not
 *     grounds to silently replace an existing non-empty name.
 *
 * Callers must never invoke this after a resolveCustomer conflict outcome
 * — see submit-instant-quote.ts, which only calls this for "matched".
 */
export function buildCustomerContactRefreshPatch(input: ContactRefreshInput): CustomerContactPatch {
  const patch: CustomerContactPatch = {};
  const { matchedBy, existingCustomer } = input;

  const submittedName = input.name.trim();
  const existingNameIsBlank = existingCustomer.name.trim().length === 0;
  if (submittedName.length > 0 && (matchedBy === "email_and_phone" || existingNameIsBlank)) {
    patch.name = submittedName;
  }

  const submittedEmail = input.email?.trim() ?? "";
  const submittedEmailNormalized = input.emailNormalized?.trim() ?? "";
  const hasNewEmail = submittedEmail.length > 0 && submittedEmailNormalized.length > 0;
  const existingEmailIsNull = existingCustomer.email === null && existingCustomer.emailNormalized === null;
  if (hasNewEmail) {
    const emailIsTheMatchedIdentifier = matchedBy === "email_and_phone" || matchedBy === "email_only";
    if (emailIsTheMatchedIdentifier || existingEmailIsNull) {
      patch.email = input.email as string;
      patch.emailNormalized = input.emailNormalized as string;
    }
  }

  const submittedPhone = input.phone?.trim() ?? "";
  const submittedPhoneNormalized = input.phoneNormalized?.trim() ?? "";
  const hasNewPhone = submittedPhone.length > 0 && submittedPhoneNormalized.length > 0;
  const existingPhoneIsNull = existingCustomer.phone === null && existingCustomer.phoneNormalized === null;
  if (hasNewPhone) {
    const phoneIsTheMatchedIdentifier = matchedBy === "email_and_phone" || matchedBy === "phone_only";
    if (phoneIsTheMatchedIdentifier || existingPhoneIsNull) {
      patch.phone = input.phone as string;
      patch.phoneNormalized = input.phoneNormalized as string;
    }
  }

  return patch;
}
