import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch-due-notifications";
import { createSupabaseCustomerNotificationPreferencesRepository } from "@/lib/notifications/customer-notification-preferences-repository";
import { getNotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { isCronRequestAuthorized } from "@/lib/notifications/cron-auth";
import { createResendNotificationEmailSender } from "@/lib/notifications/resend-notification-email-sender";
import { createNotYetSupportedNotificationSmsSender } from "@/lib/notifications/sms-sender";
import { createFakeEmailSender } from "@/lib/notifications/test-support/fake-email-sender";
import { createFakeSmsSender } from "@/lib/notifications/test-support/fake-sms-sender";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { createSupabaseCustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import { createFakeCustomerAuthLinkGenerator } from "@/lib/customer-portal/test-support/fake-customer-auth-link-generator";

/**
 * Invoked every 5 minutes by Supabase Cron (pg_cron + pg_net calling this
 * route via net.http_post — see the Notifications V1 architecture report
 * for the exact, NOT-yet-scheduled cron.schedule(...) statement and the
 * Vault secrets it depends on). Deliberately a plain Next.js server route,
 * not a Supabase Edge Function: this is a straightforward "wake up, do a
 * DB-backed batch of work" job, well within a normal serverless function's
 * timeout, so a second runtime/deployment target would add operational
 * complexity for zero benefit here.
 *
 * Auth: a shared secret compared with a constant-time check (see
 * cron-auth.ts) — never a user/admin session (this is invoked by Postgres,
 * not a browser). The secret itself is configuration only: read from
 * CRON_DISPATCH_SECRET at request time, never hardcoded, never committed
 * (see .env.example).
 *
 * Mode: NOTIFICATION_DISPATCH_MODE=fake swaps in in-memory fake senders
 * that perform no real network call at all — this is how disposable-
 * Supabase validation (and any local run) exercises the full claim/send/
 * retry pipeline against a real Postgres instance without ever sending a
 * real email. Any other value (including unset) uses the real Resend-
 * backed email sender. The SMS sender is ALWAYS the "not yet supported"
 * stand-in in this milestone regardless of mode — there is no live SMS
 * provider to select even in "real" mode, so a real SMS is structurally
 * impossible to send right now (see sms-sender.ts).
 */
async function handleDispatch(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequestAuthorized(request.headers.get("x-cron-secret"), process.env.CRON_DISPATCH_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repo = createSupabaseSchedulingRepository();
  const preferencesRepo = createSupabaseCustomerNotificationPreferencesRepository();

  const dispatchMode = process.env.NOTIFICATION_DISPATCH_MODE;
  const email = dispatchMode === "fake" ? createFakeEmailSender().sender : createResendNotificationEmailSender();
  const sms = dispatchMode === "fake" ? createFakeSmsSender().sender : createNotYetSupportedNotificationSmsSender();
  const authLinkGenerator =
    dispatchMode === "fake" ? createFakeCustomerAuthLinkGenerator().generator : createSupabaseCustomerAuthLinkGenerator();

  const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, getNotificationRecipientContact, new Date(), authLinkGenerator);
  return NextResponse.json({ ok: true, mode: dispatchMode === "fake" ? "fake" : "live", ...result });
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}
