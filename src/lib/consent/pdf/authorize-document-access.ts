export class ConsentDocumentAccessError extends Error {
  constructor(message = "This signed document does not belong to the requesting customer.") {
    super(message);
    this.name = "ConsentDocumentAccessError";
  }
}

/**
 * Defense-in-depth check used by both the customer and admin download
 * routes right before streaming bytes: signed_document_path is always
 * "{customer_id}/{filename}", so a mismatch here can only mean a bug
 * upstream (the route already scopes its DB lookup to the caller's own
 * customer_id / an explicit consent id) — never a case to silently ignore.
 */
export function assertCustomerOwnsDocumentPath(customerId: string, signedDocumentPath: string): void {
  if (!signedDocumentPath.startsWith(`${customerId}/`)) {
    throw new ConsentDocumentAccessError();
  }
}
