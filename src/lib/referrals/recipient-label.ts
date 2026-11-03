export const RECIPIENT_LABEL_MAX_LENGTH = 120;

export class RecipientLabelTooLongError extends Error {
  constructor() {
    super("RECIPIENT_LABEL_TOO_LONG");
    this.name = "RecipientLabelTooLongError";
  }
}

export class RecipientLabelTypeError extends Error {
  constructor() {
    super("RECIPIENT_LABEL_TYPE_A_REJECTED");
    this.name = "RecipientLabelTypeError";
  }
}

/**
 * Trims a recipient label. Blank becomes null. Longer than 120 characters
 * is rejected. The database applies the same rules again before write.
 */
export function normalizeRecipientLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > RECIPIENT_LABEL_MAX_LENGTH) {
    throw new RecipientLabelTooLongError();
  }
  return trimmed;
}

/** A recipient label is only valid on a Type B (admin-issued) code. */
export function assertRecipientLabelCodeType(codeType: string): void {
  if (codeType !== "admin_issued") {
    throw new RecipientLabelTypeError();
  }
}
