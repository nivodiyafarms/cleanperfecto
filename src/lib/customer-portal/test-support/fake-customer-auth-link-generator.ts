import type { CustomerAuthLinkGenerator, CustomerAuthLinkOutcome } from "../customer-auth-link";

export interface FakeCustomerAuthLinkGeneratorState {
  calls: { email: string; path: string }[];
}

export interface CreateFakeCustomerAuthLinkGeneratorOptions {
  /** Called before recording a "generate" call — return an outcome to short-circuit (e.g. simulate a generateLink failure); return undefined to succeed normally with a deterministic fake action_link. */
  behavior?: (email: string, path: string, callNumber: number) => CustomerAuthLinkOutcome | undefined;
}

/** In-memory CustomerAuthLinkGenerator for tests — never calls Supabase. */
export function createFakeCustomerAuthLinkGenerator(
  options: CreateFakeCustomerAuthLinkGeneratorOptions = {}
): { generator: CustomerAuthLinkGenerator; state: FakeCustomerAuthLinkGeneratorState } {
  const state: FakeCustomerAuthLinkGeneratorState = { calls: [] };
  let callNumber = 0;

  return {
    state,
    generator: {
      async generate(email, path) {
        callNumber += 1;
        state.calls.push({ email, path });
        const overridden = options.behavior?.(email, path, callNumber);
        if (overridden) return overridden;
        return { ok: true, actionLink: `https://fake.supabase.co/auth/v1/verify?token=fake-${callNumber}&type=magiclink&redirect_to=${encodeURIComponent(path)}` };
      },
    },
  };
}
