import { loadStripe, type Stripe } from '@stripe/stripe-js';

// Publishable key is browser-safe. Card payments are only offered when it's set
// (and the backend has its secret key — see card_setup's "disabled" ack).
const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export const stripeConfigured = !!key;

let promise: Promise<Stripe | null> | null = null;

/** Lazily-loaded Stripe.js singleton (null if no publishable key). */
export function getStripe(): Promise<Stripe | null> {
  if (!key) return Promise.resolve(null);
  if (!promise) promise = loadStripe(key);
  return promise;
}
