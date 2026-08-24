import type { NotificationEmailSendInput, NotificationEmailSendResult, NotificationEmailSender } from "../email-sender";

export interface FakeEmailSenderState {
  sentEmails: NotificationEmailSendInput[];
}

export interface CreateFakeEmailSenderOptions {
  /** Called before recording a "send" — return a result to short-circuit (e.g. simulate a provider failure); return undefined to succeed normally. Lets tests exercise the retry/failure path without a real provider. */
  behavior?: (input: NotificationEmailSendInput, callNumber: number) => NotificationEmailSendResult | undefined;
}

/** In-memory NotificationEmailSender for tests and disposable validation — never performs a real send. */
export function createFakeEmailSender(options: CreateFakeEmailSenderOptions = {}): { sender: NotificationEmailSender; state: FakeEmailSenderState } {
  const state: FakeEmailSenderState = { sentEmails: [] };
  let callNumber = 0;

  return {
    state,
    sender: {
      async send(input) {
        callNumber += 1;
        state.sentEmails.push(input);
        const overridden = options.behavior?.(input, callNumber);
        if (overridden) return overridden;
        return { sent: true, providerMessageId: `fake-email-${callNumber}` };
      },
    },
  };
}
