"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseCustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import { computeAgreedQuoteReferenceTotal, createAgreedQuote, type CreateAgreedQuoteInput } from "@/lib/instant-quote/create-agreed-quote";
import { createSupabaseAgreedQuoteInvitationRepository } from "@/lib/instant-quote/supabase-agreed-quote-invitation-repository";
import { createSupabaseInstantQuoteRepository } from "@/lib/instant-quote/supabase-repository";
import type { InstantQuotePropertyType } from "@/lib/instant-quote/types";
import { renewAgreedQuoteInvitation, sendAgreedQuoteInvitation } from "@/lib/instant-quote/send-agreed-quote-invitation";
import { createResendNotificationEmailSender } from "@/lib/notifications/resend-notification-email-sender";
import type { AddOnId, CleaningType, Condition, FrequencyId } from "@/lib/pricing/types";
import { actionError, actionOk, type ActionResult } from "./types";

function revalidateAgreedQuotePaths(invitationId?: string): void {
  revalidatePath("/admin/agreed-quotes");
  if (invitationId) revalidatePath(`/admin/agreed-quotes/${invitationId}`);
}

function parseAddOnIds(formData: FormData): AddOnId[] {
  return formData.getAll("addOnIds").map(String) as AddOnId[];
}

function parseOptionalString(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function parseCreateAgreedQuoteInput(formData: FormData, createdByAdminUserId: string): CreateAgreedQuoteInput | string[] {
  const errors: string[] = [];

  const existingCustomerId = parseOptionalString(formData, "existingCustomerId");
  const newCustomerName = parseOptionalString(formData, "newCustomerName");
  const newCustomerEmail = parseOptionalString(formData, "newCustomerEmail");
  const newCustomerPhone = parseOptionalString(formData, "newCustomerPhone");

  const agreedTotalRaw = Number(String(formData.get("agreedTotal") ?? ""));
  if (!Number.isFinite(agreedTotalRaw) || agreedTotalRaw <= 0) {
    errors.push("Enter an agreed price greater than $0.");
  }

  const visitCountRaw = Number(String(formData.get("visitCount") ?? "1"));
  const isPrepaidPackage = formData.get("isPrepaidPackage") === "on" || formData.get("isPrepaidPackage") === "true";

  const line1 = String(formData.get("serviceAddressLine1") ?? "").trim();
  const zip = String(formData.get("serviceAddressZip") ?? "").trim();
  if (!line1 || !zip) errors.push("A service address (street and ZIP) is required.");

  if (errors.length > 0) return errors;

  return {
    existingCustomerId,
    customerContact: existingCustomerId ? undefined : { name: newCustomerName ?? "", email: newCustomerEmail ?? "", phone: newCustomerPhone ?? null },
    propertyType: String(formData.get("propertyType") ?? "home") as InstantQuotePropertyType,
    cleaningType: String(formData.get("cleaningType") ?? "standard") as CleaningType,
    condition: String(formData.get("condition") ?? "moderate") as Condition,
    rooms: {
      bedrooms: Number(String(formData.get("bedrooms") ?? "0")),
      fullBathrooms: Number(String(formData.get("fullBathrooms") ?? "1")),
      halfBathrooms: Number(String(formData.get("halfBathrooms") ?? "0")),
    },
    squareFeet: formData.get("squareFeet") ? Number(String(formData.get("squareFeet"))) : undefined,
    serviceAddress: {
      line1,
      line2: parseOptionalString(formData, "serviceAddressLine2"),
      city: parseOptionalString(formData, "serviceAddressCity"),
      state: parseOptionalString(formData, "serviceAddressState"),
      zip,
    },
    frequency: String(formData.get("frequency") ?? "one_time") as FrequencyId,
    isPrepaidPackage,
    visitCount: isPrepaidPackage ? Math.max(6, visitCountRaw || 6) : 1,
    addOnIds: parseAddOnIds(formData),
    agreedTotal: agreedTotalRaw,
    negotiationChannel: parseOptionalString(formData, "negotiationChannel") as CreateAgreedQuoteInput["negotiationChannel"],
    negotiationNotes: parseOptionalString(formData, "negotiationNotes"),
    agreedRequestedDate: parseOptionalString(formData, "agreedRequestedDate"),
    agreedRequestedStartTime: parseOptionalString(formData, "agreedRequestedStartTime"),
    supersedesInvitationId: parseOptionalString(formData, "supersedesInvitationId"),
    createdByAdminUserId,
  };
}

const CUSTOMER_CONFLICT_MESSAGE =
  "This contact matches more than one existing customer identity, or the email matches one customer while the phone matches a different one — select the correct existing customer instead of entering contact details again.";

/**
 * Creates the agreed quote + invitation and sends it immediately — one
 * combined action, matching the stated requirement ("review the details,
 * and send a secure invitation immediately"). §5/RBAC: the reference-price
 * discount check runs BEFORE any row is written, so an operations admin
 * attempting a below-reference price is rejected with no partial writes.
 */
export async function createAndSendAgreedQuoteAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "create_agreed_quote");

  const parsed = parseCreateAgreedQuoteInput(formData, admin.adminUserId);
  if (Array.isArray(parsed)) return actionError(parsed.join(" "));

  const asOf = new Date();
  const referenceTotal = computeAgreedQuoteReferenceTotal(parsed, asOf);
  const isDiscount = referenceTotal === null || parsed.agreedTotal < referenceTotal;
  if (isDiscount) {
    assertCapability(admin.role, "financial_correction");
  }

  const repo = createSupabaseInstantQuoteRepository();
  const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();
  const result = await createAgreedQuote(repo, invitationRepo, parsed, asOf);

  if (!result.ok) {
    if (result.stage === "customer_conflict") return actionError(CUSTOMER_CONFLICT_MESSAGE);
    if (result.stage === "customer_missing_email") return actionError("This customer has no email on file — add one before creating an agreed quote.");
    if (result.stage === "supersede_failed") return actionError("The offer being revised already has an enrollment in progress or was already replaced — revision aborted.");
    if (result.stage === "validation") return actionError(result.errors.join(" "));
    return actionError("We couldn't create this agreed quote right now. Please try again.");
  }

  const sendResult = await sendAgreedQuoteInvitation(
    {
      invitationRepo,
      authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(),
      emailSender: createResendNotificationEmailSender(),
    },
    result.invitationId
  );

  revalidateAgreedQuotePaths(result.invitationId);

  if (!sendResult.ok) {
    return actionOk(`Agreed quote created, but the invitation email failed to send (${sendResult.reason}). Use Resend from the detail page.`);
  }
  return actionOk("Agreed quote created and invitation sent.");
}

/** Same as create-and-send, but supersedes an existing invitation — surfaced as a distinct action name for the admin UI's "Revise" button, which always pre-fills supersedesInvitationId. */
export async function reviseAgreedQuoteInvitationAction(prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return createAndSendAgreedQuoteAction(prevState, formData);
}

export async function resendAgreedQuoteInvitationAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "create_agreed_quote");
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return actionError("Missing invitation id.");

  const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();
  const result = await sendAgreedQuoteInvitation(
    { invitationRepo, authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(), emailSender: createResendNotificationEmailSender() },
    invitationId
  );
  revalidateAgreedQuotePaths(invitationId);

  if (result.ok) return actionOk("Invitation resent.");
  const MESSAGE: Record<Exclude<typeof result.reason, undefined>, string> = {
    not_found: "Invitation not found.",
    invalid_state: "This invitation can no longer be resent (already completed, cancelled, or superseded).",
    customer_missing_email: "This customer has no email on file — add one before resending.",
    link_generation_failed: "Couldn't generate a secure link just now. Please try again shortly.",
    send_failed: "The email failed to send after retrying. Please try again shortly.",
    duplicate_request: "A send was already sent moments ago — please wait before trying again.",
    rate_limited: "This invitation has reached the resend limit for the past hour — please wait before trying again.",
  };
  return actionError(MESSAGE[result.reason]);
}

/**
 * The explicit, deliberate staff action for an expired (or soon-expiring)
 * offer — requires the admin to have reviewed price/availability first
 * (enforced in the UI as a required confirmation checkbox on this same
 * form, never re-derived from system state here).
 */
export async function renewAgreedQuoteInvitationAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "create_agreed_quote");
  const invitationId = String(formData.get("invitationId") ?? "");
  const confirmed = formData.get("confirmedPriceAndAvailability") === "on" || formData.get("confirmedPriceAndAvailability") === "true";
  if (!invitationId) return actionError("Missing invitation id.");
  if (!confirmed) return actionError("Confirm that you've reviewed the price and availability before renewing this offer.");

  const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();
  const result = await renewAgreedQuoteInvitation(
    { invitationRepo, authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(), emailSender: createResendNotificationEmailSender() },
    invitationId,
    admin.adminUserId
  );
  revalidateAgreedQuotePaths(invitationId);

  if (result.ok) return actionOk("Offer renewed and a fresh invitation link was sent.");
  if (result.reason === "invalid_state") return actionError("This invitation can no longer be renewed (already completed, cancelled, or superseded).");
  return actionError("The offer's validity window was extended, but sending the fresh link failed. Use Resend from the detail page.");
}

export async function cancelAgreedQuoteInvitationAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "create_agreed_quote");
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return actionError("Missing invitation id.");

  const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();
  const cancelled = await invitationRepo.claimAgreedQuoteInvitationCancellation(invitationId, admin.adminUserId, new Date());
  revalidateAgreedQuotePaths(invitationId);

  if (cancelled) return actionOk("Invitation cancelled.");

  const invitation = await invitationRepo.findAgreedQuoteInvitationById(invitationId);
  if (!invitation) return actionError("Invitation not found.");
  if (invitation.status === "completed" || invitation.status === "cancelled" || invitation.status === "superseded") {
    return actionError("This invitation is already in a terminal state and cannot be cancelled.");
  }
  return actionError("An enrollment is currently in progress for this offer — wait for it to complete or fail before cancelling.");
}
