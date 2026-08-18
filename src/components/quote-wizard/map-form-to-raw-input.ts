import type { AddOnId } from "@/lib/pricing/types";
import type { InstantQuoteRawInput } from "@/lib/instant-quote/types";
import type { PostEstimateDetails, WizardFormState } from "./wizard-types";

/** Fixed — the currently supported operational area is DFW, Texas; never re-typed by the customer. */
const FIXED_STATE = "TX";

/**
 * Every Phase 1 wizard submission is an ordinary (non-prepaid) quote — no
 * customer-facing package toggle exists in this milestone (see
 * wizard-types.ts). isPrepaidPackage/visitCount are fixed at the backend's
 * own ordinary-quote values; the trusted core's package support itself is
 * untouched, just not reachable from this UI yet.
 */
const ORDINARY_VISIT_COUNT = 1;

export interface AddOnSelection {
  addOnIds: AddOnId[];
}

export const EMPTY_ADD_ON_SELECTION: AddOnSelection = { addOnIds: [] };

/**
 * Maps the wizard's local form state into the exact public payload shape
 * both submitInstantQuoteRequest and previewInstantQuoteCustomization
 * expect. Never includes any authoritative field (no price, no discount,
 * no eligibility, no entryChannel, no asOf) — InstantQuoteRawInput has no
 * such fields to set even if this tried to.
 */
export function mapWizardFormToRawInput(
  formState: WizardFormState,
  addOnSelection: AddOnSelection = EMPTY_ADD_ON_SELECTION,
  postEstimate?: Pick<PostEstimateDetails, "leadSource" | "leadSourceDetail">
): InstantQuoteRawInput {
  const squareFeet = parseSquareFeet(formState.squareFeet);
  const addressLine2 = formState.addressLine2.trim();
  const email = formState.email.trim();
  const leadSourceDetail = postEstimate?.leadSourceDetail.trim();

  return {
    propertyType: formState.propertyType,
    cleaningType: formState.cleaningType,
    condition: formState.condition,
    rooms: {
      bedrooms: formState.bedrooms,
      fullBathrooms: formState.fullBathrooms,
      halfBathrooms: formState.halfBathrooms,
    },
    squareFeet: squareFeet ?? undefined,
    frequency: formState.frequency,
    isPrepaidPackage: false,
    visitCount: ORDINARY_VISIT_COUNT,
    addOnIds: addOnSelection.addOnIds,

    name: formState.firstName.trim(),
    phone: formState.phone.trim(),
    email: email.length > 0 ? email : undefined,

    serviceAddress: {
      line1: formState.addressLine1.trim(),
      line2: addressLine2.length > 0 ? addressLine2 : undefined,
      city: formState.city.trim(),
      state: FIXED_STATE,
      zip: formState.zip.trim(),
    },

    leadSource: postEstimate?.leadSource ? postEstimate.leadSource : undefined,
    leadSourceDetail: leadSourceDetail && leadSourceDetail.length > 0 ? leadSourceDetail : undefined,
  };
}

function parseSquareFeet(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
