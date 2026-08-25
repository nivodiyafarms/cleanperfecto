import type { TipSelectionType } from "@/lib/scheduling/types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";

/** Hard technical ceiling — a Custom tip above this is rejected server-side outright, never merely warned about. Business-approved value. */
export const CUSTOM_TIP_HARD_CEILING = 1000;

/** A Custom tip above tip_basis_amount (100%) OR above this flat dollar figure — whichever is reached first — requires an explicit second confirmation from the customer before it's accepted. Presets (15/20/25%) never trigger this, even in an edge case that would mathematically exceed it. */
export const CUSTOM_TIP_CONFIRMATION_FLAT_THRESHOLD = 200;

const TIP_PERCENTAGE_BY_SELECTION: Record<Exclude<TipSelectionType, "custom">, number> = {
  percentage_15: 15,
  percentage_20: 20,
  percentage_25: 25,
};

export interface ResolveTipAmountInput {
  tipSelectionType: TipSelectionType;
  tipBasisAmount: number;
  /** Only read when tipSelectionType is "custom" — a client-submitted dollar amount for a percentage selection is never used (see resolveTipAmount's own guard). */
  customAmount?: number;
}

export interface ResolvedTipAmount {
  tipAmount: number;
  tipPercentage: number | null;
  /** True only for a Custom tip crossing the confirmation threshold — never true for a preset. */
  requiresConfirmation: boolean;
}

/**
 * The one place a tip dollar amount is ever computed — always server-side,
 * always from tipBasisAmount (never tax, never an existing tip, never fees).
 * For a percentage selection, customAmount is never read even if supplied —
 * this is what makes "client cannot submit a trusted percentage dollar
 * amount" true by construction, not by validation.
 */
export function resolveTipAmount(input: ResolveTipAmountInput): ResolvedTipAmount {
  if (input.tipSelectionType !== "custom") {
    const percentage = TIP_PERCENTAGE_BY_SELECTION[input.tipSelectionType];
    const tipAmount = roundToCents((input.tipBasisAmount * percentage) / 100);
    return { tipAmount, tipPercentage: percentage, requiresConfirmation: false };
  }

  const customAmount = input.customAmount;
  if (customAmount === undefined || customAmount === null || Number.isNaN(customAmount)) {
    throw new InvalidVisitStateError("A custom tip amount is required.");
  }
  if (customAmount < 0) {
    throw new InvalidVisitStateError("Tip amount cannot be negative.");
  }
  if (customAmount > CUSTOM_TIP_HARD_CEILING) {
    throw new InvalidVisitStateError(`Tip amount cannot exceed $${CUSTOM_TIP_HARD_CEILING}.`);
  }

  const tipAmount = roundToCents(customAmount);
  const requiresConfirmation = tipAmount > input.tipBasisAmount || tipAmount > CUSTOM_TIP_CONFIRMATION_FLAT_THRESHOLD;
  return { tipAmount, tipPercentage: null, requiresConfirmation };
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
