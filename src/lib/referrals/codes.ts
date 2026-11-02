import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from "./constants";

const CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const compact = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(compact)) return null;
  return compact;
}

export function generateReferralCode(randomByte: () => number = defaultRandomByte): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_CODE_ALPHABET[randomByte() % REFERRAL_CODE_ALPHABET.length];
  }
  return code;
}

function defaultRandomByte(): number {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] ?? 0;
}

export class ReferralCodeCollision extends Error {
  constructor() {
    super("REFERRAL_CODE_COLLISION");
    this.name = "ReferralCodeCollision";
  }
}

/**
 * One reusable code per customer. A unique-code collision retries with a new
 * random value. A concurrent insert for the same customer returns the row
 * that won the race instead of creating a second code.
 */
export async function allocateCustomerReferralCode(deps: {
  findExisting: () => Promise<{ code: string } | null>;
  tryInsert: (code: string) => Promise<{ code: string }>;
  generate?: () => string;
  maxAttempts?: number;
}): Promise<{ code: string }> {
  const existing = await deps.findExisting();
  if (existing) return existing;

  const generate = deps.generate ?? (() => generateReferralCode());
  const maxAttempts = deps.maxAttempts ?? 8;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generate();
    try {
      return await deps.tryInsert(code);
    } catch (error) {
      if (!(error instanceof ReferralCodeCollision)) {
        const raced = await deps.findExisting();
        if (raced) return raced;
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ReferralCodeCollision();
}
