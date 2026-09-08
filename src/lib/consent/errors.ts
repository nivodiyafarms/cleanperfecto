/** Raised when a consent operation targets a row/version that isn't in a state the operation supports (e.g. signing an already-signed row, or a version that isn't the currently active one). */
export class InvalidConsentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConsentStateError";
  }
}

/**
 * Raised when the consent_versions row the customer was shown (and checked
 * the box against) is no longer the currently active version by the time
 * their submission reaches the server — e.g. an admin published a new
 * version in the gap between page load and submit. The caller must never
 * silently record acceptance of a different version than the one actually
 * presented; instead it surfaces the now-current version so the client can
 * re-render it and ask the customer to review and accept again.
 */
export class ConsentVersionChangedError extends Error {
  constructor(public readonly currentVersionId: string) {
    super("The terms have been updated since you loaded this page. Please review and accept the current version.");
    this.name = "ConsentVersionChangedError";
  }
}
