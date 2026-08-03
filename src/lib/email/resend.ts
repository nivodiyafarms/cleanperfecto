import "server-only";

import { Resend } from "resend";

/**
 * Creates a Resend client for trusted server-side email operations only.
 * Never import this module into a Client Component.
 */
export function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  return new Resend(apiKey);
}
