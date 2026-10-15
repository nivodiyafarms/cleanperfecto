"use server";

import { createSupabaseCustomerAuthLinkGenerator } from "../customer-auth-link";
import { createResendNotificationEmailSender } from "@/lib/notifications/resend-notification-email-sender";
import { claimCustomerLoginLinkRequest } from "../claim-customer-login-link-request";
import {
  requestCustomerLoginLink,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
  type RequestCustomerLoginLinkResult,
} from "../request-customer-login-link";

/** Backs CustomerLoginForm's submit handler — called directly as a plain async function (not a <form action>), same pattern as the payment actions. */
export async function requestCustomerLoginLinkAction(email: string, next: string): Promise<RequestCustomerLoginLinkResult> {
  return requestCustomerLoginLink(
    {
      claimLoginLinkRequest: (emailNormalized, now) =>
        claimCustomerLoginLinkRequest(emailNormalized, now, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_ATTEMPTS),
      authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(),
      emailSender: createResendNotificationEmailSender(),
    },
    email,
    next
  );
}
