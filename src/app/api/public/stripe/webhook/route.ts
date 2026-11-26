// Stripe webhook endpoint. Point a Stripe webhook at <APP_ORIGIN>/api/public/stripe/webhook with the events
// checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// payment_intent.payment_failed and charge.refunded, and set STRIPE_WEBHOOK_SECRET to its signing secret.
import { drainAfterResponse } from '@/server/platform/after';
import { receiveStripeWebhook } from '@/server/revenue/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const response = await receiveStripeWebhook(request);
  drainAfterResponse();
  return response;
}
