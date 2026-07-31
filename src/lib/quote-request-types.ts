export interface QuoteRequestPayload {
  name: string;
  phone: string;
  email: string;
  zip: string;
  propertyType: string;
  serviceId: string;
  preferredDate: string;
  message: string;
}

export type SubmitQuoteRequestResult =
  | { ok: true }
  | { ok: false; message: string };
