import "server-only";

import Stripe from "stripe";

let cachedClient: Stripe | null = null;

/**
 * Singleton Stripe client, instantiated on the current `StripeClient`
 * instance pattern (never the deprecated global/module-level API key
 * pattern). No `apiVersion` is pinned here — the installed `stripe`
 * package version determines it, so this codebase never carries a
 * hand-copied version string that can silently drift out of date.
 *
 * `STRIPE_SECRET_KEY` is read once per process; use a Stripe TEST MODE key
 * during development (see .env.example). Never logged, never sent to the
 * client — this file has no client-safe counterpart.
 */
export function getStripeClient(): Stripe {
  if (cachedClient) {
    return cachedClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("[booking] STRIPE_SECRET_KEY is not configured.");
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
}
