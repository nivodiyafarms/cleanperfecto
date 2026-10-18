import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { AddOnId, CleaningType, Condition, FrequencyId, MoveDirection, MovePackageLevel, OutdoorSelection } from "@/lib/pricing/types";
import { AGREED_QUOTE_INVITATION_VALIDITY_DAYS } from "./agreed-quote-constants";
import type { AgreedQuoteInvitationRepository, NegotiationChannel } from "./agreed-quote-invitation-repository";
import { buildCalculationInput } from "./build-calculation-input";
import { buildManualPricingSnapshot } from "./build-manual-pricing-snapshot";
import { buildCustomerContactRefreshPatch } from "./contact-refresh";
import { buildQuoteRequestRow } from "./build-quote-request-row";
import { resolveLegacyServiceId } from "./legacy-service-id";
import { buildServiceAddressIdentity } from "./normalize-address";
import { normalizeEmail } from "./normalize-email";
import { normalizePhone } from "./normalize-phone";
import type { InstantQuoteRepository } from "./repository";
import { resolveCustomer, type CustomerIdentityConflictReason } from "./resolve-customer";
import type { InstantQuotePropertyType, RawRoomCounts, RawServiceAddress, ValidatedInstantQuoteInput } from "./types";

export interface CreateAgreedQuoteInput {
  /** Admin explicitly picked an existing customer from search — skips resolveCustomer entirely. */
  existingCustomerId?: string;
  /** Used when existingCustomerId is absent. Email is REQUIRED for this flow (not merely preferred) — the secure invitation link is an email-only magic link, unlike the public wizard where either phone or email suffices. */
  customerContact?: { name: string; email: string; phone: string | null };

  propertyType: InstantQuotePropertyType;
  cleaningType: CleaningType;
  condition: Condition;
  rooms: RawRoomCounts;
  squareFeet?: number;
  serviceAddress: RawServiceAddress;

  frequency: FrequencyId;
  isPrepaidPackage: boolean;
  visitCount: number;
  addOnIds: AddOnId[];
  movePackageLevel?: MovePackageLevel;
  moveDirection?: MoveDirection;
  outdoorSelection?: OutdoorSelection;

  /** The admin's exact negotiated figure — must be > 0. Preserved verbatim, never recalculated. */
  agreedTotal: number;

  negotiationChannel?: NegotiationChannel;
  negotiationNotes?: string;
  /** Optional pre-agreed appointment — still only ever a REQUEST, never a confirmed one. See §4 of the plan. */
  agreedRequestedDate?: string;
  agreedRequestedStartTime?: string;

  /** Revision flow: supersedes an existing invitation (which must currently be pending_send/sent). */
  supersedesInvitationId?: string;

  createdByAdminUserId: string;
}

export type CreateAgreedQuoteResult =
  | { ok: true; quoteId: string; customerId: string; invitationId: string }
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "customer_conflict"; reason: CustomerIdentityConflictReason; conflictingCustomerIds: string[] }
  | { ok: false; stage: "customer_missing_email" }
  | { ok: false; stage: "supersede_failed" }
  | { ok: false; stage: "persistence"; error: string };

function validate(input: CreateAgreedQuoteInput): string[] {
  const errors: string[] = [];
  if (!input.existingCustomerId && !input.customerContact) {
    errors.push("Select an existing customer or enter new customer contact details.");
  }
  if (input.customerContact && !input.customerContact.email.trim()) {
    errors.push("A customer email is required to send a secure invitation.");
  }
  if (!Number.isFinite(input.agreedTotal) || input.agreedTotal <= 0) {
    errors.push("Enter an agreed price greater than $0.");
  }
  if (!Number.isInteger(input.visitCount) || input.visitCount <= 0) {
    errors.push("Visit count must be a positive whole number.");
  }
  if (input.isPrepaidPackage && input.visitCount < 6) {
    errors.push("A prepaid package requires at least 6 visits.");
  }
  if (input.isPrepaidPackage && input.frequency === "one_time") {
    errors.push("A prepaid package requires a recurring frequency (weekly, biweekly, or every 4 weeks).");
  }
  if (!input.serviceAddress.line1.trim() || !input.serviceAddress.zip.trim()) {
    errors.push("A service address (street and ZIP) is required.");
  }
  return errors;
}

/** ValidatedInstantQuoteInput-shaped object for buildCalculationInput/buildQuoteRequestRow — both of which expect that exact shape. Contact fields are placeholders unless contactOverride is supplied (buildQuoteRequestRow's call site, once the real customer is resolved). */
function toValidatedShape(input: CreateAgreedQuoteInput, contactOverride?: { name: string; email: string | null; phone: string | null }): ValidatedInstantQuoteInput {
  return {
    propertyType: input.propertyType,
    cleaningType: input.cleaningType,
    condition: input.condition,
    rooms: input.rooms,
    squareFeet: input.squareFeet ?? null,
    frequency: input.frequency,
    isPrepaidPackage: input.isPrepaidPackage,
    visitCount: input.visitCount,
    addOnIds: input.addOnIds,
    visitAddOns: null,
    specialRooms: [],
    movePackageLevel: input.movePackageLevel ?? null,
    moveDirection: input.moveDirection ?? null,
    outdoorSelection: input.outdoorSelection ?? null,
    quantifiedAddOns: [],
    // Contact fields are irrelevant to buildCalculationInput (which only
    // reads scope/pricing fields) — placeholders here, the real resolved
    // values are used later for buildQuoteRequestRow via toValidatedShape's
    // second call with contactOverride.
    name: contactOverride?.name ?? "",
    phone: contactOverride?.phone ?? null,
    email: contactOverride?.email ?? null,
    serviceAddress: {
      line1: input.serviceAddress.line1,
      line2: input.serviceAddress.line2 ?? null,
      city: input.serviceAddress.city ?? null,
      state: input.serviceAddress.state ?? null,
      zip: input.serviceAddress.zip,
    },
    preferredDate: null,
    message: null,
    leadSource: null,
    leadSourceDetail: null,
  };
}

/** Builds the same CalculationInput buildManualPricingSnapshot uses, for callers (the admin server action, and tests) that need to run the real calculateEstimate as a REFERENCE-ONLY check before authorization decisions. firstCleaningEligible is inert here — the output is used only as a reference comparison, never persisted or applied to any discount program. */
export function buildAgreedQuoteCalculationInput(input: CreateAgreedQuoteInput, asOf: Date) {
  return buildCalculationInput(toValidatedShape(input), false, asOf);
}

/**
 * Reference-only price the real pricing engine would produce for this exact
 * scope — used ONLY to decide whether the admin's agreedTotal represents a
 * discretionary discount (see §5/RBAC: preserving the owner-only discount
 * gate). Never persisted, never shown to the customer. Null means "the
 * engine itself would require manual review for this scope" — treated the
 * same as a discount by the caller, since there's no clean number to
 * compare against.
 */
export function computeAgreedQuoteReferenceTotal(input: CreateAgreedQuoteInput, asOf: Date): number | null {
  const calculationInput = buildAgreedQuoteCalculationInput(input, asOf);
  const result = calculateEstimate(calculationInput);
  if (result.manualReviewRequired) return null;
  if (input.isPrepaidPackage) return result.prepaidPackageTotal;
  return result.calculatedTotal;
}

/** Minimal direct read, self-contained rather than cross-importing another feature's repository — same convention as getNotificationRecipientContact. Exported for reuse by send-agreed-quote-invitation.ts/renew. */
export async function findCustomerContactById(customerId: string): Promise<{ id: string; name: string; email: string | null; phone: string | null } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("customers").select("id, name, email, phone").eq("id", customerId).maybeSingle();
  if (error) throw new Error(`[agreed-quote] customer lookup failed: ${error.message}`);
  return data ?? null;
}

/**
 * Admin orchestrator — parallel to, never calling, submitInstantQuote. The
 * admin's agreed price bypasses calculateEstimate entirely (see
 * buildManualPricingSnapshot); only resolveCustomer/buildQuoteRequestRow are
 * reused unchanged from the public quote pipeline.
 *
 * Unlike submitInstantQuote, a customer-identity conflict here is a HARD
 * STOP — never proceeds with a null customerId, since booking_orders.
 * customer_id is NOT NULL and this feature exists specifically to end in a
 * bookable state.
 */
export async function createAgreedQuote(
  repo: InstantQuoteRepository,
  invitationRepo: AgreedQuoteInvitationRepository,
  input: CreateAgreedQuoteInput,
  asOf: Date = new Date(),
  /** Injectable seam purely for tests (same "deterministic clock override" pattern as asOf/submitInstantQuote) — production callers never pass this, getting the real Supabase-backed lookup. */
  findCustomerContact: typeof findCustomerContactById = findCustomerContactById
): Promise<CreateAgreedQuoteResult> {
  const errors = validate(input);
  if (errors.length > 0) {
    return { ok: false, stage: "validation", errors };
  }

  let customerId: string;
  let customerName: string;
  let customerEmail: string | null;
  let customerPhone: string | null;

  if (input.existingCustomerId) {
    const customer = await findCustomerContact(input.existingCustomerId);
    if (!customer) {
      return { ok: false, stage: "validation", errors: ["Selected customer not found."] };
    }
    customerId = customer.id;
    customerName = customer.name;
    customerEmail = customer.email;
    customerPhone = customer.phone;
  } else {
    const contact = input.customerContact!;
    const emailNormalized = normalizeEmail(contact.email);
    const phoneNormalizeResult = contact.phone ? normalizePhone(contact.phone) : null;
    const phoneNormalized = phoneNormalizeResult?.valid ? phoneNormalizeResult.e164 : null;

    const resolution = await resolveCustomer(
      { name: contact.name, email: contact.email, emailNormalized, phone: contact.phone, phoneNormalized },
      repo
    );

    if (resolution.outcome === "conflict") {
      return { ok: false, stage: "customer_conflict", reason: resolution.reason, conflictingCustomerIds: resolution.conflictingCustomerIds };
    }

    customerId = resolution.customer.id;
    customerName = resolution.customer.name;
    customerEmail = resolution.customer.email;
    customerPhone = resolution.customer.phone;
    if (resolution.outcome === "matched") {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: resolution.matchedBy,
        existingCustomer: resolution.customer,
        name: contact.name,
        email: contact.email,
        emailNormalized,
        phone: contact.phone,
        phoneNormalized,
      });
      if (Object.keys(patch).length > 0) {
        await repo.updateCustomerContact(customerId, patch);
        customerEmail = patch.email ?? customerEmail;
        customerPhone = patch.phone ?? customerPhone;
      }
    }
  }

  if (!customerEmail) {
    return { ok: false, stage: "customer_missing_email" };
  }

  const resolvedEmailNormalized = normalizeEmail(customerEmail);
  const resolvedPhoneNormalizeResult = customerPhone ? normalizePhone(customerPhone) : null;
  const resolvedPhoneNormalized = resolvedPhoneNormalizeResult?.valid ? resolvedPhoneNormalizeResult.e164 : null;

  const calculationInput = buildAgreedQuoteCalculationInput(input, asOf);
  const calculationResult = buildManualPricingSnapshot({
    calculationInput,
    agreedTotal: input.agreedTotal,
    scopeAddOnIds: input.addOnIds,
    asOf,
  });

  const serviceAddressIdentity = buildServiceAddressIdentity({
    zip: input.serviceAddress.zip,
    line1: input.serviceAddress.line1,
    line2: input.serviceAddress.line2,
  });
  const legacyServiceId = resolveLegacyServiceId(input.cleaningType, input.frequency);
  const validatedForRow = toValidatedShape(input, { name: customerName, email: customerEmail, phone: customerPhone });

  const quoteId = randomUUID();
  const row = buildQuoteRequestRow({
    id: quoteId,
    customerId,
    entryChannel: "admin",
    validated: validatedForRow,
    emailNormalized: resolvedEmailNormalized,
    phoneNormalized: resolvedPhoneNormalized,
    serviceAddressIdentity,
    legacyServiceId,
    calculationInput,
    calculationResult,
  });

  const insertResult = await repo.insertQuoteRequest(row);
  if (!insertResult.ok) {
    return { ok: false, stage: "persistence", error: insertResult.error };
  }

  if (input.supersedesInvitationId) {
    const superseded = await invitationRepo.supersedeAgreedQuoteInvitation(input.supersedesInvitationId, asOf);
    if (!superseded) {
      // The old invitation is no longer in a supersedable state (someone
      // just started checkout on it, or it was already replaced/cancelled).
      // Never leave a dangling new quote_requests row with no invitation —
      // the new quote row is immutable (pricing_snapshot already written),
      // but simply never getting an invitation means it can never become a
      // real booking, which is the safe failure mode here.
      return { ok: false, stage: "supersede_failed" };
    }
  }

  const clientRequestId = randomUUID();
  const expiresAt = new Date(asOf.getTime() + AGREED_QUOTE_INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const invitation = await invitationRepo.insertAgreedQuoteInvitation({
    quoteRequestId: quoteId,
    customerId,
    createdByAdminUserId: input.createdByAdminUserId,
    clientRequestId,
    negotiationChannel: input.negotiationChannel ?? null,
    negotiationNotes: input.negotiationNotes ?? null,
    agreedRequestedDate: input.agreedRequestedDate ?? null,
    agreedRequestedStartTime: input.agreedRequestedStartTime ?? null,
    expiresAt: expiresAt.toISOString(),
    supersedesInvitationId: input.supersedesInvitationId ?? null,
  });

  return { ok: true, quoteId, customerId, invitationId: invitation.id };
}
