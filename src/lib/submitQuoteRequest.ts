export interface QuoteRequestPayload {
  name: string;
  phone: string;
  email: string;
  propertyType: string;
  serviceId: string;
  zip: string;
  preferredDate: string;
  message: string;
}

/**
 * Single integration point for the quote/contact form. No backend is
 * connected yet — replace this body with a real email/API call before
 * deployment without touching the form component itself.
 */
export async function submitQuoteRequest(
  payload: QuoteRequestPayload
): Promise<{ ok: boolean }> {
  console.info("Quote request captured (no backend connected yet):", payload);
  return { ok: true };
}
