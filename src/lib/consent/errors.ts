/** Raised when a consent operation targets a row/version that isn't in a state the operation supports (e.g. signing an already-signed row, or a version that isn't the currently active one). */
export class InvalidConsentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConsentStateError";
  }
}
