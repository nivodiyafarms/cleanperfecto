import type { NotificationSmsSendInput, NotificationSmsSendResult, NotificationSmsSender } from "../sms-sender";

export interface FakeSmsSenderState {
  sentSms: NotificationSmsSendInput[];
}

export interface CreateFakeSmsSenderOptions {
  behavior?: (input: NotificationSmsSendInput, callNumber: number) => NotificationSmsSendResult | undefined;
}

/** In-memory NotificationSmsSender for tests only — never performs a real send. No Twilio (or any provider) exists in this milestone; this fake is the only implementation ever exercised end-to-end. */
export function createFakeSmsSender(options: CreateFakeSmsSenderOptions = {}): { sender: NotificationSmsSender; state: FakeSmsSenderState } {
  const state: FakeSmsSenderState = { sentSms: [] };
  let callNumber = 0;

  return {
    state,
    sender: {
      async send(input) {
        callNumber += 1;
        state.sentSms.push(input);
        const overridden = options.behavior?.(input, callNumber);
        if (overridden) return overridden;
        return { sent: true, providerMessageId: `fake-sms-${callNumber}` };
      },
    },
  };
}
