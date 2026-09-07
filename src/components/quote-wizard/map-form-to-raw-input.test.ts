import { describe, expect, it } from "vitest";
import { mapWizardFormToRawInput } from "./map-form-to-raw-input";
import { DEFAULT_WIZARD_FORM_STATE, type WizardFormState } from "./wizard-types";

function formState(overrides: Partial<WizardFormState> = {}): WizardFormState {
  return {
    ...DEFAULT_WIZARD_FORM_STATE,
    zip: "75056",
    firstName: "Jane",
    phone: "469-555-0100",
    email: "jane@example.com",
    addressLine1: "123 Main St",
    city: "Frisco",
    ...overrides,
  };
}

describe("mapWizardFormToRawInput", () => {
  it("maps the core cleaning selections", () => {
    const input = mapWizardFormToRawInput(formState({ propertyType: "apartment", cleaningType: "deep", bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1, condition: "heavy" }));
    expect(input.propertyType).toBe("apartment");
    expect(input.cleaningType).toBe("deep");
    expect(input.rooms).toEqual({ bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1 });
    expect(input.condition).toBe("heavy");
  });

  it("fixes state to TX and carries the ZIP from step 1", () => {
    const input = mapWizardFormToRawInput(formState({ zip: "75001" }));
    expect(input.serviceAddress.state).toBe("TX");
    expect(input.serviceAddress.zip).toBe("75001");
  });

  it("trims the first name and uses it as the full name field", () => {
    const input = mapWizardFormToRawInput(formState({ firstName: "  Jane  " }));
    expect(input.name).toBe("Jane");
  });

  it("omits email when blank rather than sending an empty string", () => {
    const input = mapWizardFormToRawInput(formState({ email: "" }));
    expect(input.email).toBeUndefined();
  });

  it("includes email when provided", () => {
    const input = mapWizardFormToRawInput(formState({ email: "jane@example.com" }));
    expect(input.email).toBe("jane@example.com");
  });

  it("omits addressLine2 when blank", () => {
    const input = mapWizardFormToRawInput(formState({ addressLine2: "" }));
    expect(input.serviceAddress.line2).toBeUndefined();
  });

  it("includes addressLine2 when provided (apartment unit)", () => {
    const input = mapWizardFormToRawInput(formState({ addressLine2: "Apt 4B" }));
    expect(input.serviceAddress.line2).toBe("Apt 4B");
  });

  it("parses a valid numeric square footage", () => {
    const input = mapWizardFormToRawInput(formState({ squareFeet: "1500" }));
    expect(input.squareFeet).toBe(1500);
  });

  it("omits square footage when blank", () => {
    const input = mapWizardFormToRawInput(formState({ squareFeet: "" }));
    expect(input.squareFeet).toBeUndefined();
  });

  it("omits square footage when non-numeric junk is entered, rather than sending garbage", () => {
    const input = mapWizardFormToRawInput(formState({ squareFeet: "abc" }));
    expect(input.squareFeet).toBeUndefined();
  });

  it("omits square footage when zero or negative", () => {
    expect(mapWizardFormToRawInput(formState({ squareFeet: "0" })).squareFeet).toBeUndefined();
    expect(mapWizardFormToRawInput(formState({ squareFeet: "-5" })).squareFeet).toBeUndefined();
  });

  describe("Phase 1 is always an ordinary (non-prepaid), one-time quote", () => {
    it("always submits frequency: one_time, isPrepaidPackage: false, and the ordinary visitCount — frequency is not a customer-facing field on Step 1 at all", () => {
      const input = mapWizardFormToRawInput(formState());
      expect(input.frequency).toBe("one_time");
      expect(input.isPrepaidPackage).toBe(false);
      expect(input.visitCount).toBe(1);
    });

    it("has no frequency field on WizardFormState at all — a structural guarantee, not just a runtime default (owner-approved 2026-08-19: frequency removed from the initial quote)", () => {
      const state = formState();
      expect("frequency" in state).toBe(false);
    });

    it("has no isPrepaidPackage field on WizardFormState at all — a structural guarantee, not just a runtime default", () => {
      const state = formState();
      expect("isPrepaidPackage" in state).toBe(false);
    });

    it("never sends visitAddOns — no per-visit package UI exists in this wizard", () => {
      const input = mapWizardFormToRawInput(formState(), { addOnIds: ["inside_oven"] });
      expect(input.visitAddOns).toBeUndefined();
    });
  });

  it("passes through the given add-on selection", () => {
    const input = mapWizardFormToRawInput(formState(), { addOnIds: ["inside_oven"] });
    expect(input.addOnIds).toEqual(["inside_oven"]);
  });

  it("defaults to an empty add-on selection when none is given", () => {
    const input = mapWizardFormToRawInput(formState());
    expect(input.addOnIds).toEqual([]);
  });

  it("omits post-estimate leadSource when not supplied — optional and never blocks the initial submission", () => {
    const input = mapWizardFormToRawInput(formState());
    expect(input.leadSource).toBeUndefined();
    expect(input.leadSourceDetail).toBeUndefined();
  });

  it("has no preferredDate field to set at all — removed for Phase 1 (real scheduling belongs to the future Booking + Payment milestone)", () => {
    const input = mapWizardFormToRawInput(formState());
    expect(input).not.toHaveProperty("preferredDate");
  });

  it("includes post-estimate lead-source details when supplied", () => {
    const input = mapWizardFormToRawInput(formState(), EMPTY_ADD_ON_SELECTION_FOR_TEST, {
      leadSource: "google",
      leadSourceDetail: "search ad",
    });
    expect(input.leadSource).toBe("google");
    expect(input.leadSourceDetail).toBe("search ad");
  });

  it("does not smuggle any authoritative pricing field — the return type has none to set", () => {
    const input = mapWizardFormToRawInput(formState());
    expect(input).not.toHaveProperty("calculatedTotal");
    expect(input).not.toHaveProperty("firstCleaningEligible");
    expect(input).not.toHaveProperty("entryChannel");
    expect(input).not.toHaveProperty("asOf");
  });

  // -------------------------------------------------------------------
  // 2026-08-30 pricing hotfix: Game/Media Room, Move package level/
  // direction, outdoor selections, and quantified add-ons.
  // -------------------------------------------------------------------

  it("maps Game Room / Media Room selections", () => {
    const input = mapWizardFormToRawInput(formState(), { addOnIds: [], specialRooms: ["game_room", "media_room"] });
    expect(input.specialRooms).toEqual(["game_room", "media_room"]);
  });

  it("omits specialRooms when none are selected", () => {
    const input = mapWizardFormToRawInput(formState());
    expect(input.specialRooms).toBeUndefined();
  });

  it("maps movePackageLevel and moveDirection only when cleaningType is move", () => {
    const moveInput = mapWizardFormToRawInput(
      formState({ cleaningType: "move", moveDirection: "move_in" }),
      { addOnIds: [], movePackageLevel: "complete" }
    );
    expect(moveInput.movePackageLevel).toBe("complete");
    expect(moveInput.moveDirection).toBe("move_in");

    const standardInput = mapWizardFormToRawInput(formState({ cleaningType: "standard" }), {
      addOnIds: [],
      movePackageLevel: "complete", // should be ignored — not a move request
    });
    expect(standardInput.movePackageLevel).toBeUndefined();
    expect(standardInput.moveDirection).toBeUndefined();
  });

  it("maps outdoor selections", () => {
    const input = mapWizardFormToRawInput(formState(), {
      addOnIds: [],
      outdoorSelection: { trio: "small", algaeMildewTreatmentSize: "medium" },
    });
    expect(input.outdoorSelection).toEqual({ trio: "small", algaeMildewTreatmentSize: "medium" });
  });

  it("maps quantified (per-unit) add-ons", () => {
    const input = mapWizardFormToRawInput(formState(), {
      addOnIds: [],
      quantifiedAddOns: [{ id: "interior_window_detailing", quantity: 3 }],
    });
    expect(input.quantifiedAddOns).toEqual([{ id: "interior_window_detailing", quantity: 3 }]);
  });

  it("the default EMPTY_ADD_ON_SELECTION omits every new hotfix field — old-shape backward compatibility", () => {
    const input = mapWizardFormToRawInput(formState());
    expect(input.specialRooms).toBeUndefined();
    expect(input.movePackageLevel).toBeUndefined();
    expect(input.moveDirection).toBeUndefined();
    expect(input.outdoorSelection).toBeUndefined();
    expect(input.quantifiedAddOns).toBeUndefined();
  });
});

const EMPTY_ADD_ON_SELECTION_FOR_TEST = { addOnIds: [] };
